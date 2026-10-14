import json
from lunar_lander_local import LunarLander
from pypybox2d import Circle

env = LunarLander(render_mode=None)
multi_envs = [LunarLander(render_mode=None) for _ in range(4)]

def scene_data(target_env, observation):
    bodies = []
    for body in target_env.drawlist + target_env.particles:
        for fixture in body.fixtures:
            shape = fixture.shape
            if isinstance(shape, Circle):
                center = body.transform * shape.position
                bodies.append({"circle": {"center": [center.x, center.y], "radius": shape.radius}, "particle": body in target_env.particles})
            elif hasattr(shape, "vertices"):
                transform = body.transform
                world_vertices = [transform * point for point in shape.vertices]
                bodies.append({"vertices": [[p.x, p.y] for p in world_vertices], "particle": False})
    return {"observation": observation.tolist(), "terrain": target_env.sky_polys,
            "pad": [target_env.helipad_x1, target_env.helipad_y, target_env.helipad_x2], "bodies": bodies}

def reset_json():
    observation, _ = env.reset()
    return json.dumps(scene_data(env, observation))

def step_json(action):
    observation, reward, terminated, truncated, _ = env.step(int(action))
    return json.dumps({"state": scene_data(env, observation), "reward": reward,
                       "terminated": terminated, "truncated": truncated})

def reset_many_seeded_json(payload_json):
    payload = json.loads(payload_json)
    seed = int(payload["seed"])
    gravity = float(payload.get("gravity", -10.0))
    scenes = []
    for sim_env in multi_envs:
        sim_env.gravity = gravity
        sim_env.world.gravity = (0, gravity)
        observation, _ = sim_env.reset(seed=seed)
        scenes.append(scene_data(sim_env, observation))
    return json.dumps(scenes)

def step_many_json(payload_json):
    payload = json.loads(payload_json)
    actions = payload["actions"]
    active = payload["active"]
    hazards = payload.get("hazards", {})
    gravity = float(hazards.get("gravity", -10.0))
    wind = float(hazards.get("wind", 0.0))
    results = []
    for sim_env, action, should_step in zip(multi_envs, actions, active):
        if not should_step:
            results.append(None)
            continue
        sim_env.world.gravity = (0, gravity)
        if wind and sim_env.lander is not None:
            sim_env.lander.apply_force_to_center((wind, 0))
        observation, reward, terminated, truncated, _ = sim_env.step(int(action))
        results.append({"state": scene_data(sim_env, observation), "reward": reward,
                        "terminated": terminated, "truncated": truncated})
    return json.dumps(results)
