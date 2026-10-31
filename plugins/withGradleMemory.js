const { withGradleProperties } = require('expo/config-plugins');

// R8 (release builds are shrunk) runs out of Metaspace with the template's 512 MB.
module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (c) => {
    const props = c.modResults.filter((p) => !(p.type === 'property' && p.key === 'org.gradle.jvmargs'));
    props.push({ type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m -XX:MaxMetaspaceSize=1024m' });
    c.modResults = props;
    return c;
  });
};
