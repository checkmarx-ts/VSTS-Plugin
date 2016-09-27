del *.vsix
#tsc
tfx extension create --manifest-globs vss-extension.json
#tfx extension publish --share-with Checkmarx --token p22v2tzawa6nic7x6odxj2letrch4cxx6ikob7owufupg2bkxpfq
echo | pause
