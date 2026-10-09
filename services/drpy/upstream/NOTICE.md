# drpyS runtime provenance

The installer downloads the prebuilt `drpy-node-bundle/libs/localDsCore.bundled.js` and its SQLite WebAssembly asset from:

- Repository: https://github.com/Hululu007/drpy-node
- Revision: `295f2b7047e14122d542a7736cb931e81abcf85c`
- Complete corresponding source: https://github.com/Hululu007/drpy-node/tree/295f2b7047e14122d542a7736cb931e81abcf85c
- Checksums: `scripts/install-drpy.mjs`

The downloaded runtime is kept unmodified in `.runtime/drpy`, outside the application bundle. The upstream repository's `LICENSE` file is retained here as `COPYING` (GNU GPL version 3); its package manifest separately declares MIT. This integration retains the upstream license text and source provenance rather than resolving that upstream discrepancy by changing the license. Copyright and license notices embedded in the runtime are retained.

`services/drpy/server.mjs` is the LibreTV HTTP host. `services/drpy/rules/cctv-public.js` is a locally maintained public CCTV rule, executed through the actual drpyS engine. The upstream full web application, plugin manager, PHP host, and Python daemon are not launched.
