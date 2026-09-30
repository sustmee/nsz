# Third-party libraries

These files are copied unmodified from their npm packages (only source-map comments were removed)
so the site works without any CDN or build step.

| File | Package | Version | License |
| --- | --- | --- | --- |
| `pdf.min.js`, `pdf.worker.min.js` | [pdfjs-dist](https://github.com/mozilla/pdf.js) (legacy build) | 6.3.289 | Apache-2.0 |
| `mammoth.browser.min.js` | [mammoth](https://github.com/mwilliamson/mammoth.js) | 1.13.0 | BSD-2-Clause |
| `turndown.js` | [turndown](https://github.com/mixmark-io/turndown) | 7.2.4 | MIT |
| `turndown-plugin-gfm.js` | [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) | 1.0.2 | MIT |
| `marked.umd.js` | [marked](https://github.com/markedjs/marked) | 18.0.14 | MIT |
| `jszip.min.js` | [jszip](https://github.com/Stuk/jszip) | 3.10.2 | MIT or GPL-3.0 |
| `purify.min.js` | [dompurify](https://github.com/cure53/DOMPurify) | 3.4.16 | MPL-2.0 or Apache-2.0 |

To update one, run `npm pack <package>@<version>`, copy the same file from the package, and update this table.
