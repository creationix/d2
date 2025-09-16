
# D2: A Lazy-Loaded, Append-Only JSONL Format

This document describes a serialization format and a corresponding storage architecture designed for efficiently distributing large, versioned datasets to numerous consumers in a cache-friendly manner. The primary use case is for publishing data like deployment manifests to a CDN.

### Core Goals of the Design

 - **Efficient Random Access**: Allow consumers to parse only the necessary parts of a large dataset without reading the entire file.
 - **High Data Density**: Reduce total file size through aggressive deduplication of values/structures and compact object schemas.
 - **Cache-Friendly Incremental Updates**: Enable consumers to fetch only the delta when a new version of the dataset is published.
 - **Atomic Version Switching**: Allow for instantaneous activation or rollback of dataset versions.
 - **Mostly Human Readable**: This is about as human readable as possible while still retaining properties of general purpose deduplication and random access.

## Part 1: The Serialization Format

The format is a variant of JSON Lines (JSONL) with specific rules for data representation and linking.

 1. **Base Format**: The file is a standard JSONL document where each line is a valid JSON value.
 2. **Pointers**: In objects and arrays, any value that is a `number` is interpreted as a 1-based line number pointer to another line in the document. This enables lazy-loading and aggressive deduplication of any JSON value (strings, numbers, objects, arrays).
 3. **Compact Object Representation**: To reduce key repetition, an array can represent an object. If an array's first element is a negative number (e.g., `-2`), it signifies that `2` is a pointer to line `2` containing an array of key strings. The subsequent elements in the current array are the values corresponding to those keys.
 4. **Root Node**: The last line of the logical document represents the root node.

### Example:

#### Original JSON

```json
{ "children": [ { "type": "directory", "name": "add-ons" } ] }
```

#### Encoded Format

```json
"directory"           // 1: an example of a string that can be referenced
[ "type", "name" ]    // 2: the schema used on line 3
[ -2, 1, "add-ons" ]  // 3: an object with an external schema on line 2
{ "children": [ 3 ] } // 4: The root node as a normal object with keys
```

*For this particular example, there isn’t actually any duplication so it would be silly to encode this way, it’s here to show the syntax of what’s possible.*

## Part 2: The Storage & Versioning Architecture

The format is intended to be used with an immutable, append-only storage model to manage versions and facilitate efficient updates.

1.  **Immutability**: Once a line is written as part of a version, it is never mutated. The system is designed for Write-Once, Read-Many (WORM) workloads.
2.  **Append-Only Versioning**: New versions of the dataset are created by appending new lines to the logical document. These new lines can reference any existing lines from previous versions, maximizing data reuse across versions.
3.  **Atomic Snapshots**: A specific version or snapshot of the dataset is identified solely by the line number of its root node. Switching between versions is an atomic operation that only requires updating this single root pointer.
4.  **Chunked Storage**: The logical, ever-growing document is physically stored as a series of immutable, fixed-size file chunks. The files are named by their end-line number.
    - For a chunk size of 1000, a document of 2500 lines would be stored in three files named `1000.jsonl`, `2000.jsonl`, and `2500.jsonl`.
    - Clients can calculate which file chunk to fetch based on the line number they need to resolve.
5.  **Cache Efficiency**: This chunking strategy ensures that historical, immutable chunks can be cached forever by clients. An update only requires clients to fetch the one or two new file chunks at the end of the chain.

## Examples

### Full Serilization Doc

A slightly larger example of encoding can be done with this manifest for two static files.

```json
{ "version": 1,
  "children": [
    { "type": "directory",
      "name": "add-ons",
      "children": [
        { "type": "file",
          "name": "index.html",
          "contentType": "text/html; charset=utf-8" }
      ] },
    { "type": "directory",
      "name": "bugs-and-requests",
      "children": [
        { "type": "file",
          "name": "index.html",
          "contentType": "text/html; charset=utf-8" }
      ] }
  ] }
```

This is one possible encoding using the D2 format:

```json
1                                                   // 1 - number
"directory"                                         // 2 - string
["type","name","contentType"]                       // 3 - schema
[-3,"file","index.html","text/html; charset=utf-8"] // 4 - typed object
["type","name","children"]                          // 5 - schema
[-5,2,"add-ons",[4]]                                // 6 - typed object
[-5,2,"bugs-and-requests",4]                        // 7 - typed object
{"version":1,"children":[6,7]}                      // 8 - root object
```

## Revisions in Large Dataset

The following is an example showing 3 revisions of a large dataset with a large initial upload and two smaller incremental updates.

### Initial version

The initial version of the document contains 6317 lines and we are storing this as 1000 line blocks.

The following files would be written:

- `/:project_id/manifest/1000.d2.jsonl` - lines 1-1000
- `/:project_id/manifest/2000.d2.jsonl` - lines 2001-3000
- `/:project_id/manifest/3000.d2.jsonl` - lines 3001-4000
- `/:project_id/manifest/4000.d2.jsonl` - lines 4001-5000
- `/:project_id/manifest/5000.d2.jsonl` - lines 5001-6000
- `/:project_id/manifest/6000.d2.jsonl` - lines 6001-7000
- `/:project_id/manifest/6317.d2.jsonl` - lines 6001-6317

### Incremental Update 1

Then an incremental update to the dataset which resulted in 423 new lines being added is made.  One new file is created.

- `/:project_id/manifest/6740.d2.jsonl` - lines 6001-6740

### Incremental Update 2

Then another change adds 833 lines creating two more new files.

- `/:project_id/manifest/7000.d2.jsonl` - this block is finally full
- `/:project_id/manifest/7573.d2.jsonl` - lines 7001-7573
  
As you can see, each incremental update only adds new lines for the paths in the prefix trie that are actually changed.  Then the on-disk representation writes only those new lines plus any lines already written to the current block that is not full yet.

This means that, on-average, each write duplicates about half a block of data. Tune your blocks accordingly.