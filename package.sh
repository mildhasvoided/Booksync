#!/bin/bash

echo "1: package"
echo "2: unpackage"
read -rp "> " choice

case "$choice" in
  1)
    if [ ! -d "Booksync" ]; then
      echo "Error: 'Booksync' directory not found."
      exit 1
    fi
    zip -r Booksync.zip Booksync
    echo "Done: Booksync.zip created."
    ;;
  2)
    if [ ! -f "Booksync.zip" ]; then
    clear
      echo "Error: 'Booksync.zip' not found."
      exit 1
    fi
    if [ -d "Booksync" ]; then
      mv "Booksync" "Booksync (Old)"
      echo "Renamed existing 'Booksync' to 'Booksync (Old)'."
    fi
    unzip Booksync.zip
    clear
    echo "Done: Booksync extracted."
    ;;
  *)
    clear
    echo "Invalid choice. Enter 1 or 2."

    exit 1
    ;;
esac
