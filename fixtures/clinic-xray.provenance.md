# Clinic X-ray fixture provenance and license

## Fixture

| Field | Value |
|---|---|
| Repository path | `fixtures/clinic-xray.png` |
| Content | Real posteroanterior chest radiograph |
| Format | Metadata-free, 8-bit grayscale PNG |
| Dimensions | 1,929 x 2,207 pixels (4,257,303 pixels) |
| File size | 1,830,194 bytes |
| SHA-256 | `aec7a9ff0a1880c27df73d2cb726485e4ed4905e2e1847113eb7b9baa2cef287` |

## Canonical source and license

| Field | Value |
|---|---|
| Title | *Normal posteroanterior (PA) chest radiograph (X-ray).jpg* |
| Author | Mikael Häggström |
| Institution | None stated; the Commons record identifies it as the author's own work |
| Canonical source page | <https://commons.wikimedia.org/wiki/File:Normal_posteroanterior_(PA)_chest_radiograph_(X-ray).jpg> |
| Original file URL | <https://upload.wikimedia.org/wikipedia/commons/a/a1/Normal_posteroanterior_%28PA%29_chest_radiograph_%28X-ray%29.jpg> |
| License | Creative Commons CC0 1.0 Universal Public Domain Dedication |
| License URL | <https://creativecommons.org/publicdomain/zero/1.0/> |
| Redistribution/modification | Permitted, including commercial use |
| Attribution required | No |
| Voluntary credit | “Normal posteroanterior (PA) chest radiograph (X-ray)” by Mikael Häggström, Wikimedia Commons, CC0 1.0 |

The Commons description identifies this as a normal PA chest radiograph. The original is 1,929 x
2,207 pixels, 906,335 bytes, and has Commons-listed SHA-1
`3124c4cf4c55eb3d2defa9b909f08f94e941ec43`. Its SHA-256 is
`4cbbcf805291db949e4ff085ca3c7258b2823de21b2857ae684e6c91ff9a38a4`.

For reproducible acquisition independent of canonical-host availability, the exact original bytes
are pinned to the public mirror commit at
<https://github.com/Bishnu2430/Nabz/blob/2c274c576b7964cf171c6fcbf8142b90e2fe46f4/data/imaging/chest-xray-normal-pa.jpg>.
The mirror's byte count and SHA-1 match the Commons record, and its SHA-256 matches the pinned
original value above. Those hash checks establish byte-for-byte equivalence between the pinned
mirror acquisition and the canonical original.

## Transformation and integrity

1. Decoded the original JPEG without cropping, resizing, rotating, contrast adjustment, annotation,
   or other pixel editing.
2. Confirmed that the source's red, green, and blue channels are byte-identical grayscale data.
3. Re-encoded that grayscale data as PNG without carrying over JFIF density or other metadata.
4. Confirmed that source and derived images have the same decoded RGB-pixel SHA-256:
   `ec9dbe457c44c8d0f6fc7e531419d30c652da6b5a72106e78546a3933b4e3f39`.
5. Confirmed that the derived PNG contains only `IHDR`, `IDAT`, and `IEND` chunks. It has no EXIF,
   XMP, ICC profile, text, timestamp, location, or other ancillary metadata.

## De-identification review

Visual inspection found no name, date of birth, accession number, hospital or facility identifier,
study date, or other patient identifier burned into the pixels. The only visible text is `Dx` and
`Sin`, the source's right/left orientation markers; these are not patient identifiers. No diagnostic
labels or annotations were added.

## Educational limitation

This fixture is only for the public Enhanced AI Recorder Clinic test flow: local description of
visible structures and demonstration of non-diagnostic clinician handoff behavior. It is not a
diagnostic reference and must not be used for diagnosis, triage, treatment, patient care, or
clinical model validation. Any model output about it requires clinician review.
