// Voice typing is iPhone only for now, so its two native packages stay out of the Android app.
module.exports = {
  dependencies: {
    '@siteed/sherpa-onnx.rn': { platforms: { android: null } },
    'llama.rn': { platforms: { android: null } },
  },
};
