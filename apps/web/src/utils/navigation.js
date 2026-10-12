export function goBackOrFallback(navigate, fallback = '/operations-hub') {
  if (window.history.length > 1) {
    navigate(-1);
    return;
  }

  navigate(fallback, { replace: true });
}
