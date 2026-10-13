# Third-party runtime wheel

## PyPyBox2D 2.1-r331

The project uses the pure-Python portion of PyPyBox2D, authored by Ken Lauer.
Its source project is preserved in the [Google Code Archive](https://code.google.com/archive/p/pybox2d/),
and its [PyPI 2.1-r331 release](https://pypi.org/project/pypybox2d/2.1-r331/)
contains the source distribution (but no universal wheel).

`wheels/pypybox2d-2.1.post331-py3-none-any.whl` is a universal, pure-Python
wheel packaged once from that release's Python modules. The source archive's
SHA-256 is `bb67604798d802ac322ae626f2dd6a236e9f0900adf0896e54ad118f12b95a7e`;
the committed wheel's SHA-256 is
`3fae535f1b89e827f3e97d29637131e3aeb002a7752a5b94aefaeca981879a8d`. The wheel
contains the upstream Python modules and original zlib license notice. It is
committed as a standalone third-party artifact and reused by local installs
and browser deployments; CI does not rebuild it.

The upstream license asks that the origin not be misrepresented and that the
license notice remain with source distributions. This attribution and the
original notice are retained here and in the wheel.
