"""Playable LunarLander-v2-style environment backed by pure-Python PyPyBox2D.

This is a local POC, not a drop-in Gymnasium distribution. Its reset/step
contract and state/reward layout mirror Gymnasium's LunarLander-v2.
"""

import math
import numpy as np

import gymnasium as gym
from gymnasium import spaces
from gymnasium.utils import EzPickle

from pypybox2d import Circle, Edge, RevoluteJoint, World


FPS = 50
SCALE = 30.0
MAIN_ENGINE_POWER = 13.0
SIDE_ENGINE_POWER = 0.6
INITIAL_RANDOM = 1000.0
LANDER_POLY = [(-14, 17), (-17, 0), (-17, -10), (17, -10), (17, 0), (14, 17)]
LEG_AWAY, LEG_DOWN, LEG_W, LEG_H = 20, 18, 2, 8
LEG_SPRING_TORQUE = 40
SIDE_ENGINE_HEIGHT, SIDE_ENGINE_AWAY = 14.0, 12.0
VIEWPORT_W, VIEWPORT_H = 600, 400


class LunarLander(gym.Env, EzPickle):
    metadata = {"render_modes": ["human"], "render_fps": FPS}

    def __init__(self, render_mode="human", gravity=-10.0, continuous=False):
        EzPickle.__init__(self, render_mode=render_mode, gravity=gravity, continuous=continuous)
        self.render_mode = render_mode
        self.gravity = gravity
        self.continuous = continuous
        self.observation_space = spaces.Box(
            np.array([-1.5, -1.5, -5.0, -5.0, -math.pi, -5.0, 0.0, 0.0], dtype=np.float32),
            np.array([1.5, 1.5, 5.0, 5.0, math.pi, 5.0, 1.0, 1.0], dtype=np.float32),
        )
        self.action_space = spaces.Box(-1, 1, shape=(2,), dtype=np.float32) if continuous else spaces.Discrete(4)
        # PyPyBox2D is pure Python; use modest solver counts and disable its
        # costly continuous-physics TOI pass for interactive terminal speed.
        self.world = World(gravity=(0, gravity), continuous_physics=False)
        self.screen = None
        self.clock = None
        self.particles = []
        self.prev_shaping = None
        self.game_over = False
        self.lander = None
        self.moon = None
        self.legs = []
        self.drawlist = []
        self.episode_steps = 0
        self.max_episode_steps = 1000

    def _on_contact(self, contact):
        a, b = contact.fixture_a.body, contact.fixture_b.body
        if self.lander is a or self.lander is b:
            self.game_over = True
        for leg in self.legs:
            if leg is a or leg is b:
                leg.ground_contact = True

    def _on_separate(self, contact):
        a, b = contact.fixture_a.body, contact.fixture_b.body
        for leg in self.legs:
            if leg is a or leg is b:
                leg.ground_contact = False

    def _destroy(self):
        if self.moon is None:
            return
        for body in list(self.world.bodies):
            self.world.destroy_body(body)
        self.moon = self.lander = None
        self.legs = []
        self.particles = []
        self.drawlist = []

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self._destroy()
        self.world.contact_manager.begin_contact = self._on_contact
        self.world.contact_manager.end_contact = self._on_separate
        self.game_over = False
        self.prev_shaping = None
        self.episode_steps = 0

        width, height = VIEWPORT_W / SCALE, VIEWPORT_H / SCALE
        chunks = 11
        terrain_h = self.np_random.uniform(0, height / 2, size=(chunks + 1,))
        chunk_x = [width / (chunks - 1) * i for i in range(chunks)]
        self.helipad_x1 = chunk_x[chunks // 2 - 1]
        self.helipad_x2 = chunk_x[chunks // 2 + 1]
        self.helipad_y = height / 4
        for i in range(chunks // 2 - 2, chunks // 2 + 3):
            terrain_h[i] = self.helipad_y
        smooth_y = [0.33 * (terrain_h[i - 1] + terrain_h[i] + terrain_h[i + 1]) for i in range(chunks)]

        self.moon = self.world.create_static_body()
        self.sky_polys = []
        for i in range(chunks - 1):
            p1, p2 = (chunk_x[i], smooth_y[i]), (chunk_x[i + 1], smooth_y[i + 1])
            self.moon.create_edge_fixture(p1, p2, friction=0.1)
            self.sky_polys.append([p1, p2, (p2[0], height), (p1[0], height)])
        # Close the terrain at both ends and support the visible flat base.
        self.moon.create_edge_fixture((0, 0), (width, 0), friction=0.1)

        initial_y = height
        self.lander = self.world.create_dynamic_body(position=(width / 2, initial_y), angle=0.0)
        self.lander.create_polygon_fixture(
            vertices=[(x / SCALE, y / SCALE) for x, y in LANDER_POLY],
            density=5.0, friction=0.1, category_bits=0x0010, mask_bits=0x001,
        )
        self.lander.apply_force_to_center(
            (self.np_random.uniform(-INITIAL_RANDOM, INITIAL_RANDOM), self.np_random.uniform(-INITIAL_RANDOM, INITIAL_RANDOM))
        )

        self.legs = []
        for i in (-1, 1):
            leg = self.world.create_dynamic_body(
                position=(width / 2 - i * LEG_AWAY / SCALE, initial_y), angle=i * 0.05,
            )
            leg.create_polygon_fixture(
                box=(LEG_W / SCALE, LEG_H / SCALE), density=1.0,
                category_bits=0x0020, mask_bits=0x001,
            )
            leg.ground_contact = False
            if i == -1:
                lower, upper = 0.4, 0.9
            else:
                lower, upper = -0.9, -0.4
            joint = RevoluteJoint(
                self.lander, leg,
                local_anchor_a=(0, 0), local_anchor_b=(i * LEG_AWAY / SCALE, LEG_DOWN / SCALE),
                lower_angle=lower, upper_angle=upper, max_motor_torque=LEG_SPRING_TORQUE,
                motor_speed=0.3 * i, limit_enabled=True, motor_enabled=True,
            )
            self.world.add_joint(joint)
            self.legs.append(leg)
        self.drawlist = [self.lander] + self.legs
        if self.render_mode == "human":
            self.render()
        # Match Gymnasium v0.26 LunarLander: reset advances one no-op frame.
        return self.step(np.array([0, 0], dtype=np.float32) if self.continuous else 0)[0], {}

    def _create_particle(self, mass, x, y, ttl):
        particle = self.world.create_dynamic_body(position=(x, y))
        particle.create_circle_fixture(radius=2 / SCALE, density=mass, friction=0.1,
                                      category_bits=0x0100, mask_bits=0x001, restitution=0.3)
        particle.ttl = ttl
        particle.color1 = (255, 150, 80)
        self.particles.append(particle)
        self._clean_particles(False)
        return particle

    def _clean_particles(self, all_particles=False):
        while self.particles and (all_particles or self.particles[0].ttl < 0):
            self.world.destroy_body(self.particles.pop(0))

    def step(self, action):
        if self.lander is None:
            raise RuntimeError("Call reset() before step().")
        if self.continuous:
            action = np.clip(action, -1, 1).astype(np.float32)
        elif not self.action_space.contains(action):
            raise ValueError("Action must be an integer from 0 to 3.")

        tip = (math.sin(self.lander.angle), math.cos(self.lander.angle))
        side = (-tip[1], tip[0])
        dispersion = [self.np_random.uniform(-1, 1) / SCALE for _ in range(2)]
        main_power = 0.0
        if (self.continuous and action[0] > 0) or (not self.continuous and action == 2):
            main_power = (float(np.clip(action[0], 0, 1)) + 1) * 0.5 if self.continuous else 1.0
            ox = tip[0] * (4 / SCALE + 2 * dispersion[0]) + side[0] * dispersion[1]
            oy = -tip[1] * (4 / SCALE + 2 * dispersion[0]) - side[1] * dispersion[1]
            pos = self.lander.position
            point = (pos.x + ox, pos.y + oy)
            particle = self._create_particle(3.5, point[0], point[1], main_power)
            particle.apply_linear_impulse((ox * MAIN_ENGINE_POWER * main_power, oy * MAIN_ENGINE_POWER * main_power), point)
            self.lander.apply_linear_impulse((-ox * MAIN_ENGINE_POWER * main_power, -oy * MAIN_ENGINE_POWER * main_power), point)

        side_power = 0.0
        if (self.continuous and abs(float(action[1])) > 0.5) or (not self.continuous and action in (1, 3)):
            if self.continuous:
                direction = float(np.sign(action[1]))
                side_power = float(np.clip(abs(action[1]), 0.5, 1.0))
            else:
                direction, side_power = action - 2, 1.0
            ox = tip[0] * dispersion[0] + side[0] * (3 * dispersion[1] + direction * SIDE_ENGINE_AWAY / SCALE)
            oy = -tip[1] * dispersion[0] - side[1] * (3 * dispersion[1] + direction * SIDE_ENGINE_AWAY / SCALE)
            pos = self.lander.position
            point = (pos.x + ox - tip[0] * 17 / SCALE, pos.y + oy + tip[1] * SIDE_ENGINE_HEIGHT / SCALE)
            particle = self._create_particle(0.7, point[0], point[1], side_power)
            particle.apply_linear_impulse((ox * SIDE_ENGINE_POWER * side_power, oy * SIDE_ENGINE_POWER * side_power), point)
            self.lander.apply_linear_impulse((-ox * SIDE_ENGINE_POWER * side_power, -oy * SIDE_ENGINE_POWER * side_power), point)

        self.world.step(1.0 / FPS, 8, 3)
        # Particles are cosmetic and expire after a few simulation frames.
        for particle in self.particles:
            particle.ttl -= 0.15
        self._clean_particles(False)
        self.episode_steps += 1
        pos, vel = self.lander.position, self.lander.linear_velocity
        state = np.array([
            (pos.x - VIEWPORT_W / SCALE / 2) / (VIEWPORT_W / SCALE / 2),
            (pos.y - (self.helipad_y + LEG_DOWN / SCALE)) / (VIEWPORT_H / SCALE / 2),
            vel.x * (VIEWPORT_W / SCALE / 2) / FPS,
            vel.y * (VIEWPORT_H / SCALE / 2) / FPS,
            self.lander.angle,
            20.0 * self.lander.angular_velocity / FPS,
            float(self.legs[0].ground_contact), float(self.legs[1].ground_contact),
        ], dtype=np.float32)
        shaping = (-100 * math.sqrt(state[0] ** 2 + state[1] ** 2)
                   -100 * math.sqrt(state[2] ** 2 + state[3] ** 2)
                   -100 * abs(state[4]) + 10 * state[6] + 10 * state[7])
        reward = 0.0 if self.prev_shaping is None else shaping - self.prev_shaping
        self.prev_shaping = shaping
        reward -= main_power * 0.30 + side_power * 0.03

        terminated = False
        if self.game_over or abs(state[0]) >= 1.0:
            terminated, reward = True, -100.0
        if not self.lander.awake:
            terminated, reward = True, 100.0
        truncated = self.episode_steps >= self.max_episode_steps
        if self.render_mode == "human":
            self.render()
        return state, float(reward), terminated, truncated, {}

    def render(self):
        import pygame
        if self.screen is None:
            pygame.init()
            self.screen = pygame.display.set_mode((VIEWPORT_W, VIEWPORT_H))
            pygame.display.set_caption("LunarLander-v2 · local PyPyBox2D POC")
            self.clock = pygame.time.Clock()
        surface = self.screen
        surface.fill((9, 13, 22))
        for i in range(45):
            x, y = (i * 137 + 29) % VIEWPORT_W, (i * 71 + 19) % 280
            surface.set_at((x, y), (55 + i % 80, 65 + i % 80, 80 + i % 80))
        for poly in self.sky_polys:
            pygame.draw.polygon(surface, (15, 21, 30), [self._screen_point(p) for p in poly])
        # Terrain outline and pad.
        for fixture in self.moon.fixtures:
            shape = fixture.shape
            if isinstance(shape, Edge):
                verts = [self._screen_point(self.moon.transform * p) for p in (shape.vertex1, shape.vertex2)]
                pygame.draw.lines(surface, (112, 128, 145), False, verts, 2)
        pygame.draw.line(surface, (199, 243, 107),
                         self._screen_point((self.helipad_x1, self.helipad_y)),
                         self._screen_point((self.helipad_x2, self.helipad_y)), 4)
        for body in self.particles + self.drawlist:
            for fixture in body.fixtures:
                shape = fixture.shape
                transform = body.transform
                if isinstance(shape, Circle):
                    center = self._screen_point(transform * shape.position)
                    pygame.draw.circle(surface, getattr(body, "color1", (255, 145, 70)), center,
                                       max(1, int(shape.radius * SCALE)))
                elif not isinstance(shape, Edge) and hasattr(shape, "vertices"):
                    points = [self._screen_point(transform * p) for p in shape.vertices]
                    if len(points) >= 3:
                        pygame.draw.polygon(surface, (202, 214, 226), points)
                        pygame.draw.polygon(surface, (120, 142, 162), points, 1)
                    elif len(points) == 2:
                        pygame.draw.line(surface, (112, 128, 145), points[0], points[1], 2)
        font = pygame.font.Font(None, 20)
        hud = f"x {self.lander.position.x:5.2f}   y {self.lander.position.y:5.2f}   " \
              f"vx {self.lander.linear_velocity.x:5.2f}   vy {self.lander.linear_velocity.y:5.2f}"
        surface.blit(font.render(hud, True, (210, 222, 232)), (12, 12))
        pygame.display.flip()
        self.clock.tick(FPS)
        return True

    @staticmethod
    def _screen_point(point):
        return int(point[0] * SCALE), VIEWPORT_H - int(point[1] * SCALE)

    def close(self):
        if self.screen is not None:
            import pygame
            pygame.quit()
            self.screen = None


def heuristic(state):
    x, y, vx, vy, angle, angular_velocity, left_contact, right_contact = state
    angle_target = max(-0.4, min(0.4, x * 0.5 + vx))
    hover_target = 0.55 * abs(x)
    angle_todo = (angle_target - angle) * 0.5 - angular_velocity
    hover_todo = (hover_target - y) * 0.5 - vy * 0.5
    if left_contact or right_contact:
        angle_todo, hover_todo = 0, -vy * 0.5
    if hover_todo > abs(angle_todo) and hover_todo > 0.05:
        return 2
    if angle_todo < -0.05:
        return 3
    if angle_todo > 0.05:
        return 1
    return 0


if __name__ == "__main__":
    env = LunarLander()
    observation, _ = env.reset()
    print("Controls: ←/→ rotate, ↑ main engine, R reset, Esc quit")
    import pygame
    running = True
    total_reward = 0.0
    while running:
        action = 0
        for event in pygame.event.get():
            if event.type == pygame.QUIT or (event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE):
                running = False
            elif event.type == pygame.KEYDOWN and event.key == pygame.K_r:
                observation, _ = env.reset()
                total_reward = 0.0
        keys = pygame.key.get_pressed()
        if keys[pygame.K_UP]:
            action = 2
        elif keys[pygame.K_LEFT]:
            action = 1
        elif keys[pygame.K_RIGHT]:
            action = 3
        observation, reward, terminated, truncated, _ = env.step(action)
        total_reward += reward
        if terminated or truncated:
            print(f"Episode ended: reward={total_reward:.1f}; press R to restart")
            pygame.time.wait(500)
            observation, _ = env.reset()
            total_reward = 0.0
    env.close()
