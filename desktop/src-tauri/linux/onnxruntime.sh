#!/bin/sh
# Voice typing on Linux runs Microsoft's own build of ONNX Runtime (it needs only glibc 2.27),
# shipped beside the app. This fetches it, checked, from the Python package into linux/onnxruntime/.
# The build runs it when the library isn't there yet.
set -eu
cd "$(dirname "$0")"
version=1.28.0
case "$(uname -m)" in
  x86_64)
    wheel=95/df/5486ab03e9be288d5268867054c8b04bebcf95bfd12e801c05cc67703dab/onnxruntime-$version-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl
    sha256=0a83bdb70d143cede762b677789bf2a7acca54b3fb82565601d5c30695aa933c ;;
  aarch64)
    wheel=28/5b/1d77e62097fdbe07e2dc827f389b1c4c0c275f6fab0369a8f46d2461af27/onnxruntime-$version-cp312-cp312-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl
    sha256=4e81a23df16e7acb9d51b06d30cc098e49315ef9180f97bc2221d167b4b04d9c ;;
  *) echo "No ONNX Runtime build for $(uname -m)" >&2; exit 1 ;;
esac
mkdir -p onnxruntime
curl -fsSL -o onnxruntime/wheel.zip "https://files.pythonhosted.org/packages/$wheel"
echo "$sha256  onnxruntime/wheel.zip" | sha256sum -c - >/dev/null
python3 - "$version" <<'PY'
import sys, zipfile
wheel = zipfile.ZipFile("onnxruntime/wheel.zip")
for inside, name in (
    (f"capi/libonnxruntime.so.{sys.argv[1]}", "libonnxruntime.so"),
    ("LICENSE", "LICENSE"),
    ("ThirdPartyNotices.txt", "ThirdPartyNotices.txt"),
):
    with open(f"onnxruntime/{name}", "wb") as out:
        out.write(wheel.read(f"onnxruntime/{inside}"))
PY
rm onnxruntime/wheel.zip
