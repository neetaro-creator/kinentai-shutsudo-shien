# アクションプラン「該当の可能性」ヒント仕様

目的: 状況入力から、アクションプランに該当するかもしれない場合に注意を出す。**確定ではない**。適用を決めるのは消防庁長官。アプリは判定を変えず、「アクションプラン該当」は利用者が手で選ぶ。

## 入力
判定仕様.md の入力に、任意の `epicenterName`（震央地名の文字列。地震情報の取り込みで入る。手入力では空）を足したもの。
- 災害発生都道府県 `dp`: epicenterSea が true なら maxShindoPref、false なら epicenterPref（県・府・都なしの表記）。
- 震度の順序: 5弱以下 < 5強 < 6弱 < 6強 < 7。maxShindo が null の場合は震度条件を満たさない。

## 出力
`apHints(input, rules)` → 配列。各要素 `{ key, name, level, matched, checks, reasons }`。
- `key`: "shuto" | "nankai" | "nihonkaikou"。
- `level`: "strong"（入力から条件を満たすと言える）または "possible"（条件の一部が入力では確認できない）。
- `matched`: 満たした選択肢の id の配列（rules の alternatives[].id）。
- `checks`: 利用者が確認すべき事項の文の配列。
- `reasons`: 該当の可能性の根拠となる入力（日本語の短文の配列）。
- 該当しなければ、その key は返さない。アクションプランが選択済み（actionPlan が null でない）のときは空配列を返す。

## 首都直下（shuto）
- strong: maxShindoPlace が "tokyo23" で maxShindo が "6強" または "7"（東京23区で震度6強以上）。matched は ["A1"]。
- possible: 上の strong でなく、dp が "東京" で maxShindo が 6強以上。checks に「東京23区の観測点で震度6強以上があるか」。

## 日本海溝・千島海溝（nihonkaikou）
次の A1 または A2 を満たすとき possible（強い判定にはしない。観測した都道府県が入力からは特定できないため）。
- A1: dp が 青森・岩手・宮城のいずれかで、maxShindo が 6弱以上、かつ tsunamiPrefs に「1道6県」（rules.regions_definition の1道6県）のいずれかを含む。
- A2: dp が 北海道で、maxShindo が 6強以上、かつ tsunamiPrefs に1道6県のいずれかを含む。
- epicenterName が空でない場合: rules の epicenter_table.names のいずれかと完全に一致するか、names のいずれかで始まるときだけ該当にできる。一致しなければ該当にしない（震央の条件を満たさないため）。空のときは該当にでき、checks に「震央地名が表3の想定震源断層域と重なる地名か」を足す。
- checks にはさらに「その道県で震度6弱以上（北海道は6強以上）を観測したか」「1道6県のいずれかで大津波警報が出たか」を足す。

## 南海トラフ（nankai）
次の B1 または B2 を満たすとき possible。
- 地域: rules.regions_definition の「中部」「近畿」「四国・九州」の3つ。
- B1（震度）: maxShindo が 6強以上で、dp が3地域のいずれかの都道府県。matched は ["A1"]。
- B2（大津波警報）: tsunamiPrefs が3地域のそれぞれに少なくとも1つ含まれる。matched は ["A2"]。
- B3（大津波警報の一部）: tsunamiPrefs が3地域のうち1地域以上に含まれるが、3地域すべてではない。matched は ["A2"]、checks に「他の地域でも大津波警報が出たか」を足す。
- epicenterName が空でない場合は日本海溝と同じ規則で epicenter_table.names と照合し、一致しなければ該当にしない。空のときは checks に「震央地名が表2の想定震源断層域と重なる地名か」を足す。
- checks にはさらに「中部・近畿・四国九州の3地域すべてで震度6強以上、または大津波警報が出たか」を足す。
- マグニチュード8.0以上は入力にないので扱わない。

## 共通
- 返す要素が1つ以上あるとき、呼び出し側は「ここに当たらなくても長官の判断で適用されることがある」を併記する（apHints は文を返さなくてよい）。
- 地域・震央地名の表は rules（data/ap_rules.json）から引き、コードに都道府県名や震央地名を直書きしない。
