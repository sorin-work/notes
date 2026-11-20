// Lets the end-to-end tests see the API document as the build makes it.
// "nest build" runs the @nestjs/swagger plugin, which reads the DTO classes;
// ts-jest does not, unless it is handed the same plugin here, with the
// options from nest-cli.json.
// ts-jest loads this file with require(), so it has to be CommonJS.
/* eslint-disable @typescript-eslint/no-require-imports */
const { before } = require('@nestjs/swagger/plugin');
const { compilerOptions } = require('../nest-cli.json');

const { options } = compilerOptions.plugins.find((plugin) => plugin.name === '@nestjs/swagger');

module.exports.name = 'nestjs-swagger';
// Part of ts-jest's cache key: raise it when the options above change shape.
module.exports.version = 1;
module.exports.factory = (compiler) => before(options, compiler.program);
