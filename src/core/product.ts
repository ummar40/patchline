// The one place the product's name and positioning are defined. The web app presents them
// and the worker signs pull requests with the name.
export const product = {
  name: "Patchline",
  tagline: "From software issue to verified pull request.",
  description:
    "Connect a GitHub repository, describe a problem, and receive a pull request whose tests, lint, type checks and build were actually run.",
} as const;
