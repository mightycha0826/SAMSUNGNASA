# EmptyState

보여줄 목록이 아예 없을 때 화면 가운데. 88px 회색 원 안 아이콘 + 제목 한 줄 + (할 수 있으면) 버튼 하나.

- 설명 문장을 붙이지 않아요. 제목이 상태를, 버튼이 다음 행동을 말해요.
- 빈 목록: point 아이콘. 첫 로딩: `pt-empty--loading`(primary, 돌아감). 오류: `pt-empty--error`(빨강) + "다시 시도".
- 목록이 이미 있을 때는 쓰지 않아요. 그때는 `RefreshBar`나 `Toast`.
