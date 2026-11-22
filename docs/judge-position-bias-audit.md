# Seed-42 blind pilot

Calls: 40; errors: 0

Order 1 = base/head, order 2 = head/base. Null inputs byte-identical.

| Genre | Test | Repeat | Order 1 | Order 2 | Agreement |
|---|---|---|---|---|---|
| minimal | null | 1 | A | A | inconclusive |
| minimal | null | 2 | A | A | inconclusive |
| minimal | lowpass | 1 | A | B | base |
| minimal | lowpass | 2 | A | B | base |
| hypnotic | null | 1 | A | A | inconclusive |
| hypnotic | null | 2 | A | A | inconclusive |
| deephouse | null | 1 | A | A | inconclusive |
| deephouse | null | 2 | A | A | inconclusive |
| deephouse | lowpass | 1 | A | B | base |
| deephouse | lowpass | 2 | A | B | base |
| neosoul | null | 1 | A | A | inconclusive |
| neosoul | null | 2 | A | A | inconclusive |
| boombap | null | 1 | A | A | inconclusive |
| boombap | null | 2 | A | A | inconclusive |
| dnb | null | 1 | A | A | inconclusive |
| dnb | null | 2 | A | A | inconclusive |
| dnb | lowpass | 1 | A | B | base |
| dnb | lowpass | 2 | A | B | base |
| ambient | null | 1 | A | A | inconclusive |
| ambient | null | 2 | A | same | inconclusive |

Dimension order: Groove; Arrangement; Harmony; Tonal; Dynamics; Loudness; Stereo.

| Genre | Test | Repeat | Order 1 dimension preferences | Order 2 dimension preferences |
|---|---|---|---|---|
| minimal | null | 1 | A,same,same,A,A,same,same | A,same,same,A,A,same,same |
| minimal | null | 2 | A,same,same,A,A,same,same | A,same,same,A,A,same,same |
| minimal | lowpass | 1 | A,A,A,A,A,A,same | B,B,same,B,B,B,same |
| minimal | lowpass | 2 | A,A,A,A,A,A,same | B,B,same,B,B,B,same |
| hypnotic | null | 1 | A,A,same,A,A,A,same | A,same,same,A,A,A,same |
| hypnotic | null | 2 | A,same,same,A,A,A,same | A,A,same,A,A,A,same |
| deephouse | null | 1 | A,same,A,A,A,A,same | A,same,A,A,A,A,same |
| deephouse | null | 2 | A,same,A,A,A,A,same | A,same,A,A,A,A,same |
| deephouse | lowpass | 1 | A,A,A,A,A,A,same | B,B,B,B,B,same,same |
| deephouse | lowpass | 2 | A,A,A,A,A,A,same | B,B,B,B,B,B,same |
| neosoul | null | 1 | A,same,A,A,A,A,same | A,A,same,A,A,A,same |
| neosoul | null | 2 | A,A,same,A,A,A,same | A,A,same,A,A,A,same |
| boombap | null | 1 | A,same,same,A,A,A,same | A,same,same,A,A,A,same |
| boombap | null | 2 | A,same,A,A,A,A,same | A,same,A,A,A,A,same |
| dnb | null | 1 | A,same,A,A,A,A,same | A,same,A,A,A,A,same |
| dnb | null | 2 | A,same,A,A,A,A,same | A,same,A,A,A,A,same |
| dnb | lowpass | 1 | A,A,A,A,A,A,same | B,B,B,B,B,B,same |
| dnb | lowpass | 2 | A,A,A,A,A,A,same | B,B,B,B,B,B,same |
| ambient | null | 1 | same,A,A,A,same,same,same | same,A,A,A,same,same,same |
| ambient | null | 2 | same,A,A,A,same,same,same | same,same,same,same,same,same,same |
