// Maps a picker data fetch outcome to a user-facing error string, or null when
// there is nothing to show. `response` is null when the request threw (network failure).
export function describePickerError(response) {
  if (response === null) {
    return 'Could not load picker data: could not reach actualmint-api.';
  }
  if (response.ok) {
    return null;
  }
  return `Could not load picker data (${response.status})`;
}
