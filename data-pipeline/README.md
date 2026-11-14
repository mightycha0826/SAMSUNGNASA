# data-pipeline (C 슬롯)

NASA 원본 데이터를 받아 `web/public/data/`의 레이어 파일로 가공합니다. 파일이 무엇인지는 [docs/DATA.md](../docs/DATA.md)에 있습니다.

## 실행

Python 3.10 이상이 필요합니다.

```bash
pip install -r requirements.txt
python build_data.py        # 전부 다시 만든다
python validate.py          # 만든 파일을 검사한다 (실패하면 종료 코드 1)
```

- 하나만 다시 만들기: `python build_data.py optical` (`optical`, `thermal`, `topo`, `traverse`, `env`, `pov`, `layerset`)
- 겹쳐 본 그림 다시 그리기: `python validate.py --figure` → `check_overlay.png`

처음 돌릴 때 3~4분 걸립니다(잰 값: 211초). 받은 것은 `cache/`에 약 100MB 남아 다음부터는 받지 않습니다(방사선 70MB, 대기 13MB, 타일 183장, 잘라 낸 지형 16MB). 지형 파일(3.6GB)은 필요한 줄만 네트워크로 읽습니다. `cache/`는 git에 올리지 않습니다.

빈 캐시에서 처음부터 다시 만들어도 저장소에 있는 파일과 바이트 단위로 같은 결과가 나오는 것을 확인했습니다 (2026-11-14). 출력·캐시 폴더는 환경 변수 `MARSWALK_OUT`, `MARSWALK_CACHE`로 바꿀 수 있습니다.

## 파일

| 파일 | 내용 |
|---|---|
| `build_data.py` | 가공 스크립트. 맨 위 상수에 지도 범위, 기지·조사 지점, 원본 주소가 있다 |
| `validate.py` | 형식 검사, 레이어 교차 검사, 경사 기준 분석 |
| `validation_report.json` | `validate.py`가 계산한 숫자. 문서의 수치는 여기서 왔다 |
| `check_overlay.png` | 광학·지형 음영·경사도·열 위에 로버 경로를 얹은 그림 |

## 자주 바꿀 것

| 바꾸고 싶은 것 | `build_data.py`의 상수 | 다시 돌릴 단계 |
|---|---|---|
| 기지 위치 | `BASE_RMC` (주행 기록의 `RMC`) | `layerset pov` |
| 조사 지점 | `SURVEY_RMC` | `layerset pov` |
| demo 구역 크기 | `DEMO_HALF_CELLS` | `layerset` |
| 광학 영상 크기 | `OPTICAL_PX` (2048 또는 4096) | `optical` |
| 방사선·대기의 날짜 | `ENV_SOL`, `RAD_FILE`, `REMS_FILE` | `env` |

바꾼 뒤에는 `python validate.py`를 돌려 통과하는지 봅니다.

## AI 사용 고지

이 폴더의 스크립트는 AI 코딩 도구(Claude)의 도움을 받아 작성했습니다. 데이터 값은 모두 스크립트에 적힌 NASA·USGS 주소에서 받은 것입니다.
