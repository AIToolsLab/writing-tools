/* Re-export Reshaped PostCSS config
   See: https://reshaped.so/docs/getting-started/integrations/webpack
   Run `yarn add reshaped` before building to ensure this works. */
const { config } = require('reshaped/config/postcss');
module.exports = config;
