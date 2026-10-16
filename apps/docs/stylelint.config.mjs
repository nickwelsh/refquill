/** @type {import('stylelint').Config} */
const config = {
    extends: ['stylelint-config-standard', '@dreamsicle.io/stylelint-config-tailwindcss'],
    ignoreFiles: [
        'dist/**',
        '.agents/**',
        '.pnpm-store/**',
        'bootstrap/ssr/**',
        'node_modules/**',
        'public/build/**',
        'vendor/**',
    ],
    rules: {
        'at-rule-no-unknown': [true, { ignoreAtRules: ['plugin'] }],
        'at-rule-prelude-no-invalid': [true, { ignoreAtRules: ['theme'] }],
    },
};

export default config;
