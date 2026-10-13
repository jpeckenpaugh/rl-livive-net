"""Minimal subset of Gymnasium spaces needed by LunarLander."""

import numpy as np


class Box:
    def __init__(self, low, high, shape=None, dtype=np.float32):
        self.dtype = np.dtype(dtype)
        self.low = np.asarray(low, dtype=self.dtype)
        self.high = np.asarray(high, dtype=self.dtype)
        if shape is not None:
            self.low = np.broadcast_to(self.low, shape).copy()
            self.high = np.broadcast_to(self.high, shape).copy()
        self.shape = self.low.shape

    def sample(self):
        return np.random.uniform(self.low, self.high).astype(self.dtype)

    def contains(self, value):
        value = np.asarray(value)
        return value.shape == self.shape and np.all(value >= self.low) and np.all(value <= self.high)


class Discrete:
    def __init__(self, n):
        self.n = int(n)
        self.shape = ()

    def sample(self):
        return int(np.random.randint(self.n))

    def contains(self, value):
        return isinstance(value, (int, np.integer)) and 0 <= int(value) < self.n
