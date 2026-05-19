"""GitHub Actions data entry point.

The current MVP generates a deterministic full-region demo grid. Future
iterations can replace `generate_forecast_grid` with official-source fetchers
while keeping the frontend static and GitHub Pages friendly.
"""

from generate_forecast_grid import main


if __name__ == "__main__":
    main()
