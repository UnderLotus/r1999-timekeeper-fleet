# Version the public share format

Share URLs are a public compatibility boundary with no backend migration path. Any incompatible payload change increments the format version, and decoders for previously published versions remain while those links are supported. This accepts decoder maintenance so saved or shared URLs do not silently break as the compact encoding evolves.
