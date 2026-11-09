// The brand module: everything the web app's brand manager and scripts/brand-import.ts need.
// See docs/CONTRACTS.md, section 8 ("Brand module").
export {
  BRAND_ID,
  PROTECTED_BRANDS,
  brandFolder,
  brandExists,
  brandIdFromName,
  slugifyBrandName,
  checkBrand,
  readBrand,
  listBrandFiles,
  createBrand,
  duplicateBrand,
  updateBrand,
  setProvisional,
  deleteBrand,
  addBrandFile,
  removeBrandFile,
  useOpenFont,
  writePlaceholderLogo,
  makeReverseLogo,
  type BrandRecord,
  type BrandFiles,
  type CreateBrandInput,
  type BrandFileKind,
  type AddFileOptions,
  type AddFileResult,
} from "./store";
export { contrastMatrix, legalTextColours, assignColourRoles, proposeSurfaces, normaliseHex, mixWithWhite, type PairResult, type RoleGuess, type SurfaceProposal, type ColourSet } from "./palette";
export { inspectFontFile, installOpenFont, listOpenFonts, searchOpenFonts, cachedOpenFonts, textToPath, FONT_EXTENSIONS, type FontFileInfo, type OpenFont, type InstalledFace } from "./fonts";
export { inspectImage, sanitiseUploadedSvg, prepareIconSvg, svgColours, logoWarnings, type ImageInfo, type IconUploadResult } from "./assets";
export { extractGuidelinesText, suggestTokensFromText, type GuidelinesText, type TokenSuggestions, type SuggestedColour, type SuggestedFont } from "./guidelines";
export { importBrandFromFolder, parseColourList, type ImportOptions, type ImportReport, type Gap } from "./import";
export { renderBrandPreview } from "./preview";
export { contrastFixes, type ContrastFix } from "./fixes";
