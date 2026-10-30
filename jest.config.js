module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    // Jest resolves the ESM "react-native" entry; use the CommonJS build.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-.*)/)',
  ],
};
