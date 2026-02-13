---
name: image-processor
description: Processes images using ImageMagick
metadata:
  openclaw:
    requires:
      bins:
        - convert
        - identify
    os:
      - linux
      - darwin
---

# Image Processor

You can process images using ImageMagick commands.

## Usage

Use the `convert` command to resize, crop, or transform images.

```bash
convert input.png -resize 800x600 output.png
```
