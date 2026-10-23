# Go

The Go plugin: gopls answers chokepoint checks, and a text scan says which names a file's top level declares; the readings that scan text do not read Go yet.

## overrides
- source: no text scan reads Go's declarations or imports, so mass and the readings that scan text name Go as not read
  because: a Go import names a package, a folder of files, and the source slot resolves an import to one file; the slot waits for a module form of resolve (docs/plugin-language-model.md)
- interfaces: the Structure reading names Go as not read
  because: the interface map is read from the source slot's imports, which Go does not fill yet
- declares: what a Go declaration line can run is read as unknown, so a Go symbol is never taken as bodiless
  because: the interface map that asks it does not read Go yet, so an answer would go unread
- entrances: Go's entrances (func main, a net/http handler) are declared under ## entrances, never detected
  because: no entrance rule is written for Go yet; the plugin reads Go's top level and nothing else of its text
