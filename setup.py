from setuptools import find_packages, setup


setup(
    name="lunarlander-gym-shim",
    version="0.1.0",
    description="Minimal Gymnasium-compatible LunarLander-v2 environment for the Policy Lab",
    python_requires=">=3.9",
    install_requires=["numpy>=1.24,<3"],
    packages=find_packages(include=["gymnasium", "gymnasium.*"]),
    py_modules=["lunar_lander_local"],
)
