"""Tiny local Gymnasium compatibility surface used by the LunarLander POC.

This intentionally implements only what the bundled environment needs. It is
not the Gymnasium package and does not register arbitrary environments.
"""

from . import spaces


class Env:
    def reset(self, *, seed=None, options=None):
        if seed is not None:
            import numpy as np

            self.np_random = np.random.default_rng(seed)
        elif not hasattr(self, "np_random"):
            import numpy as np

            self.np_random = np.random.default_rng()


class _Logger:
    @staticmethod
    def warn(message):
        print("Warning:", message)


logger = _Logger()


def make(env_id, **kwargs):
    """Create the one environment implemented by this local compatibility shim."""
    if env_id not in ("LunarLander-v2", "LunarLander-v2-local"):
        raise ValueError(f"Unknown local environment: {env_id!r}")
    from .envs.box2d.lunar_lander import LunarLander

    return LunarLander(**kwargs)
