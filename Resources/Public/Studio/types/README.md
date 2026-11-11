# @medienreaktor/neos-studio

TypeScript declarations of the [Neos Studio](https://github.com/medienreaktor/Medienreaktor.NeosStudio)
plugin API, version 2.1.1 of Studio. Types only: a plugin imports from
`@medienreaktor/neos-studio` and marks that import (and `react`, `react-dom`,
`react/jsx-runtime`) external in its bundler, mapped to the globals the shell
publishes (`window.NeosStudio`, `window.React`, ...). Install the version
matching the Studio you build against:

```bash
npm install -D @medienreaktor/neos-studio@2.1.1 @types/react
```

See "Extending Studio" in Studio's README for the full setup.
