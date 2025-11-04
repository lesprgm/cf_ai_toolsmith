import { createRequire } from 'module';

const requireModule = createRequire(import.meta.url);

const hasModule = (name) => {
  try {
    requireModule.resolve(name);
    return true;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return false;
  }
};

const plugins = {};

if (hasModule('tailwindcss')) {
  plugins.tailwindcss = {};
}

if (hasModule('autoprefixer')) {
  plugins.autoprefixer = {};
}

export default { plugins };
