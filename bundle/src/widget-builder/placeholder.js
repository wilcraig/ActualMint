/**
 * Builds the markdown placeholder string that a Reports Text widget carries
 * for an Actual Insights widget, e.g. `{{INSIGHTS:pacing-bars:["catA","catB"]}}`.
 *
 * Single-field widgets emit the raw field value so the existing mount
 * callbacks (which receive the parsed JSON body directly) keep working.
 * Zero- or multi-field widgets emit an object keyed by each field's key.
 *
 * @param {string} widgetId
 * @param {{key: string}[]} fields
 * @param {Record<string, unknown>} values
 * @returns {string}
 */
export function buildPlaceholder(widgetId, fields, values) {
  const body = fields.length === 1 ? values[fields[0].key] : values;
  return `{{INSIGHTS:${widgetId}:${JSON.stringify(body)}}}`;
}
