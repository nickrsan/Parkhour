# Update package index
sudo apt update

# Core tools: Osmium for OSM processing, Node.js for evaluation, build tools for Tippecanoe
sudo apt install -y osmium-tool nodejs npm curl git build-essential libsqlite3-dev zlib1g-dev

# Install Tippecanoe (available in Debian 13/testing; if on Debian 12 Bookworm, build the static binary below)
if ! command -v tippecanoe &> /dev/null; then
  sudo apt install -y tippecanoe 2>/dev/null || {
    echo "Compiling tippecanoe from source..."
    git clone https://github.com/felt/tippecanoe.git /tmp/tippecanoe
    make -C /tmp/tippecanoe -j$(nproc)
    sudo make -C /tmp/tippecanoe install
    rm -rf /tmp/tippecanoe
  }
fi