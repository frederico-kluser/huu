### Added

- **`npm run dev` agora roda NATIVO, sem Docker** — a nova env `HUU_DEV_NATIVE=1` (só env, nunca flag) pula o re-exec no container para o loop de quem desenvolve o huu: editar `src/` e rodar de novo deixa de custar um `docker build` + `docker run` a cada iteração, e nem precisa do daemon ligado. O CLI imprime um banner ruidoso em todo start (en + pt-BR) porque o isolamento do container e o teto de memória do container ficam ambos ausentes; no Linux o self-wrap do systemd volta a ser alcançável e fornece o teto de kernel.
- **`npm run dev:docker`** — o comportamento anterior do `npm run dev`: mesmo hot reload, mas atravessando o Docker (refresh do `huu:local` via `scripts/ensure-image.sh` antes), que é o ensaio fiel do que o usuário recebe.

### Changed

- `decideReexec` ganhou um ramo `HUU_DEV_NATIVE` logo depois do `HUU_IN_CONTAINER`. As grafias de usuário removidas (`--yolo`, `--no-docker`, `HUU_NO_DOCKER`) continuam mortas e sem qualquer relação com a nova env — o huu segue docker-only como produto.
