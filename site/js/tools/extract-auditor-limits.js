export const EXTRACT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const EXTRACT_MAX_DATA_ROWS = 100_000;
export const EXTRACT_MAX_PHYSICAL_ROWS = 110_001;
export const EXTRACT_MAX_COLUMNS = 200;
export const EXTRACT_MAX_CELLS = 2_000_000;
export const EXTRACT_MAX_KEY_CONFIGURATION_CHARACTERS = 10_000;

export function parseExtractKeyColumns(input) {
  const text = String(input ?? "");
  if (text.length > EXTRACT_MAX_KEY_CONFIGURATION_CHARACTERS) {
    throw new Error(
      `The key-column configuration is longer than ${EXTRACT_MAX_KEY_CONFIGURATION_CHARACTERS.toLocaleString("en-CA")} characters.`
    );
  }
  const columns = text.split(",");
  if (columns.length > EXTRACT_MAX_COLUMNS) {
    throw new Error(
      `Select no more than ${EXTRACT_MAX_COLUMNS.toLocaleString("en-CA")} key columns.`
    );
  }
  return columns;
}
