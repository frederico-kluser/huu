// This file is outside .huu/ and should cause the report-only contract check to FAIL.
// The judge condition requires that git diff --name-only $baseCommit..HEAD shows
// NO modified files outside .huu/ (except at most one .gitignore adjustment).
console.log("dirty change outside .huu/");
