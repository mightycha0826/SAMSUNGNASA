# TextField

라벨이 위에 붙는 입력창. 테두리 없이 `row` 면, 모서리 16.

- 포커스: 안쪽 2px `focus` 테두리.
- 오류: `aria-invalid="true"` + 안쪽 2px `danger-line`, 아래에 느낌표 아이콘과 짧은 `danger-on-bg` 문구(`aria-describedby`로 연결).
- 자리 표시 글자는 한두 단어("입력"). 설명 문장을 넣지 않아요.
