# Manhwa18.cc post-ID hotfix

## Working contract

Manhwa18.cc 1.6.62 must refresh manga details and chapters without a WordPress
post ID. The site uses paths and embeds chapters in its manga pages.
The atomic change is one provider JAR covering its EN, KO, and ALL sources.
Suwayomi owns installation and source registration; its database remains the
authority for library membership, chapter identity, and reading progress.

Upstream `c691d6e2851741b28771ae9bf2f21ce4553fb4bb` sets
`supportsPostId = false` but `MadaraBase.fetchMangaUpdate` still throws when
`document.mangaId()` returns null. The available release is affected; previous
release asset URLs return 404.

`Manhwa18PostIdFix.java` adds `.orEmpty()` to that lookup in the exact published
JAR. Only this provider is patched. Its chapter mode does not consume the ID.
It also preserves MadaraLegacy's absolute chapter URLs with `?style=list` and
uses URI resolution when opening them. Without this, the new provider returns
slugs and Suwayomi recreates existing chapters on refresh.

The patch checks the published SHA-256 and exactly three bytecode sites,
preserves source IDs/version metadata, and removes invalidated signatures.
Redirect recovery and other post-ID lookups remain unchanged.

## Build and install

Requires JDK 17. The JDK's bundled ASM avoids another build dependency.

```sh
curl -fL https://github.com/keiyoushi/extensions/releases/download/2ba5b61/tachiyomi-all.manhwa18cc-v1.6.62.jar -o /tmp/manhwa18-original.jar
java --add-exports java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED \
  provision/suwayomi/Manhwa18PostIdFix.java \
  /tmp/manhwa18-original.jar /tmp/tachiyomi-all.manhwa18cc-v1.6.62-tetrapod.jar
curl --fail-with-body http://tetrapod:4567/api/graphql \
  -F 'operations={"query":"mutation($file: Upload!) { installExternalExtension(input:{extensionFile:$file}) { __typename } }","variables":{"file":null}}' \
  -F 'map={"0":["variables.file"]}' \
  -F '0=@/tmp/tachiyomi-all.manhwa18cc-v1.6.62-tetrapod.jar'
```

Keep the original JAR for rollback using the same installer mutation. The
version is unchanged so a later upstream release remains eligible for update.
Remove this workaround once upstream handles ID-less sources correctly.

## Evidence

Verified on the deployed Suwayomi v2.3.2243:

- Manga 1080 reproduced HTTP 500 and `Missing Madara post ID` before the fix;
  afterward details loaded, 222 chapters loaded, and a reader image returned
  HTTP 200, JPEG, 176,632 bytes.
- Installation preserved all 1,332 manga records and 8,836 existing chapter
  records, including membership, reading/bookmark flags, and download state.
- The first library refresh test exposed the chapter-URL regression: manga 663
  was reindexed. Suwayomi migrates read/bookmark flags by chapter number, but
  preservation of its prior partial-page position is unproven. Legacy URLs were
  restored and the 112 test-generated download jobs dequeued.
- With the complete fix, repeated refresh of manga 670 preserved all 169
  chapter IDs, URLs, reading positions, bookmarks, and download flags exactly.
  Existing chapter 6246 returned 42 reader pages.
- All three source IDs remained unchanged. The user confirmed manga loading.

The patch remains a temporary workaround, not an upstream release. Retire it
only after verifying both post-ID handling and chapter identity preservation.
