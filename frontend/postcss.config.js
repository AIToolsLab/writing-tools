/* ESM wrapper for Reshaped PostCSS config
   This file is loaded as ESM because package.json contains "type": "module".
   Import the reshaped config (which may be CommonJS) and export the config
   in a way that works for both CommonJS and ESM module shapes. */
import reshaped from 'reshaped/config/postcss';

const config = reshaped?.config ?? reshaped?.default ?? reshaped;

export default config;
