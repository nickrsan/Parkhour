#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Generate PMTiles for Real-Time Parking Restriction Map
# ==============================================================================
# Usage:
#   chmod +x make_pmtiles.sh
#   ./make_pmtiles.sh input.osm.pbf [output.pmtiles]
#
# Examples:
#   ./make_pmtiles.sh sacramento.osm.pbf
#   ./make_pmtiles.sh california.osm.pbf parking_ca.pmtiles
# ==============================================================================

show_usage() {
  echo "Usage: $0 <input.osm.pbf> [output.pmtiles]"
  echo ""
  echo "Arguments:"
  echo "  input.osm.pbf    Path to the raw OSM PBF file."
  echo "  output.pmtiles   Target output PMTiles file (default: parking.pmtiles)."
  exit 1
}

if [ "$#" -lt 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  show_usage
fi

INPUT_PBF="$1"
OUTPUT_PMTILES="${2:-parking.pmtiles}"

if [ ! -f "$INPUT_PBF" ]; then
  echo "Error: Input file '$INPUT_PBF' not found."
  exit 1
fi

# Check required binaries
for cmd in osmium tippecanoe; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Error: Required command '$cmd' is not installed or not in PATH."
    echo "Install dependencies via: sudo apt install -y osmium-tool tippecanoe"
    exit 1
  fi
done

TMP_DIR="$(mktemp -d -t osm_parking_XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> Working directory: $TMP_DIR"
echo "==> Input PBF:         $INPUT_PBF"
echo "==> Output PMTiles:    $OUTPUT_PMTILES"

# ------------------------------------------------------------------------------
# 1. Filter OSM ways and relations to relevant highways and parking tags
# ------------------------------------------------------------------------------
FILTERED_PBF="$TMP_DIR/filtered.osm.pbf"
echo "==> Filtering OSM ways and relations..."

osmium tags-filter "$INPUT_PBF" \
  w/highway=primary,secondary,tertiary,unclassified,residential,living_street \
  w/amenity=parking \
  r/amenity=parking \
  w/parking \
  w/parking:* \
  --overwrite \
  -o "$FILTERED_PBF"

# ------------------------------------------------------------------------------
# 2. Configure tag filtering and geometry handling for export
# ------------------------------------------------------------------------------
CONFIG_FILE="$TMP_DIR/export-config.json"
cat << 'EOF' > "$CONFIG_FILE"
{
  "attributes": {
    "type": false,
    "id": false,
    "version": false,
    "changeset": false,
    "timestamp": false,
    "uid": false,
    "user": false,
    "way_nodes": false
  },
  "area_tags": [
    "amenity=parking"
  ],
  "linear_tags": [
    "highway",
    "parking",
    "parking:*"
  ],
  "include_tags": [
    "highway",
    "amenity",
    "name",
    "access",
    "opening_hours",
    "fee",
    "capacity",
    "parking",
    "parking:*"
  ]
}
EOF

# ------------------------------------------------------------------------------
# 3. Export filtered geometries and build PMTiles
# ------------------------------------------------------------------------------
echo "==> Exporting geometries and building PMTiles..."

osmium export "$FILTERED_PBF" \
  --config="$CONFIG_FILE" \
  --geometry-types=linestring,polygon \
  --output-format=geojsonseq \
  --overwrite \
  -o - | \
tippecanoe \
  --output="$OUTPUT_PMTILES" \
  --layer="parking" \
  --minimum-zoom=12 \
  --maximum-zoom=16 \
  --no-tile-size-limit \
  --no-feature-limit \
  --read-parallel \
  --force

echo "==> Successfully created $OUTPUT_PMTILES"
ls -lh "$OUTPUT_PMTILES"
