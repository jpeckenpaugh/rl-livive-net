"""Tiny compatibility subset of Gymnasium utilities."""


class EzPickle:
    def __init__(self, *args, **kwargs):
        self._ezpickle_args = args
        self._ezpickle_kwargs = kwargs


def colorize(text, *args, **kwargs):
    return str(text)
