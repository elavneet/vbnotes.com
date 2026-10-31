const fs = require('fs');
const path = require('path');

// Android push needs Firebase's google-services.json. It stays out of the repo: EAS and the release
// workflow pass it as the GOOGLE_SERVICES_JSON file; a local build uses ./google-services.json.
module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, 'google-services.json');
  if (fs.existsSync(file)) config.android = { ...config.android, googleServicesFile: file };
  return config;
};
