.PHONY: install api web build test clean token

install:
	cd api && pip install -r requirements.txt
	cd web && npm install

token:
	@openssl rand -hex 24

api:
	cd api && uvicorn app.main:app --reload --port 8000

web:
	cd web && npm run dev

build:
	cd web && npm run build

test:
	cd api && python -m pytest tests/ -q

clean:
	rm -f api/lumnia.db
	rm -rf web/dist
