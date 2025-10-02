
run-native:
	uv run python ./src/main.py

run-wasmer:
	uvx shipit-cli --wasmer --start

testcafe-native:
	@tests/testcafe/run.sh

testcafe-record:
	@tests/testcafe/record.sh

format:
	uv format

deploy:
	uvx shipit-cli \
		--wasmer \
		--wasmer-deploy \
		--wasmer-registry https://registry.wasmer.io \
		--wasmer-app-owner wasmer-examples \
		--wasmer-app-name dnscheck
