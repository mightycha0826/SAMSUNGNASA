# 디자인 시스템

`point/` 는 **포인트 디자인 시스템**의 원본 파일입니다 (조합 1 · 코발트와 주황이 기본 테마).

| 파일 | 내용 |
|---|---|
| `point/README.md` | 원칙, 말투, 색·글자·모양·모션 규칙 |
| `point/tokens.json` | 색(라이트·다크), 글자, 간격, 모서리, 모션 토큰 |
| `point/components/` | 컴포넌트별 설명(`README.md`)과 미리보기(`preview.html`), 공용 `bundle.css`·`bundle.js` |
| `point/fonts/WantedSansVariable.woff2` | 원티드 산스 가변 글꼴 (SIL OFL 1.1) |

이 프로젝트에서 쓰는 곳:

- `web/src/hud/` — HUD는 다크 테마 토큰을 `point/tokens.json`에서 읽고(`web/src/hud/tokens.js`), 글꼴도 여기 것을 씁니다.
- `mockups/hud-mockup.html` — HUD 디자인 목업. 크기를 시야각(도)으로 옮긴 규칙이 정리돼 있습니다.

아이콘은 Material Symbols Rounded(Apache License 2.0)를 기준으로 하지만, 원본 SVG 파일은 이 폴더에 들어 있지 않습니다. HUD는 네트워크 없이도 뜨도록 아이콘을 캔버스에 직접 그립니다.
