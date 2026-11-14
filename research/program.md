# Research program

A living map of the peer-reviewed research behind how UNTERGRUND writes songs. It is internal: it exists to make the
songs better, not to be the product. Each area lists the key findings, the product principle they imply (ids from
`js/principles.js`, `PRINCIPLES_VERSION` 1), a testable hypothesis, and the benchmark metric or controlled
enjoyment-signal experiment that would test it.

- **Benchmarks** are deterministic and offline: `scripts/composition.mjs` (notes bar by bar, 8 fixed seeds per genre),
  `test/longform.mjs` (form principles), `scripts/audio-benchmark.mjs` (rendered audio), `scripts/music-benchmark.mjs`
  (determinism and diversity), and the blind A/B lab (`lab.html`).
- **Experiments** run on real listens through the improvement engine (`docs/improvement-engine.md`). Proposals live in
  `PROPOSED` in `js/principles.js` in the `EXPERIMENTS` format. None is running: starting one is a reviewed PR that
  copies it into `EXPERIMENTS` in `js/experiments.js` with `from`/`until` dates. `test/principles.mjs` checks every
  proposal's single change offline on the benchmark seeds.

Every citation below was checked against its DOI record (Crossref), arXiv or the publisher. Keys in bold are what
`js/principles.js` cites. Adding a paper: add its line under its area with a DOI or stable URL, then cite its key.

## How to read a hypothesis

A finding from a lab study is a prior, not a fact about our listeners. Our listeners skip, complete, replay, love,
down, keep, share and come back; each is its own metric with its own test (no global taste score). A hypothesis is
settled only by a controlled experiment with a primary metric, guardrails, and enough listens per arm
(`perArm()` in `js/principles.js`: two-sided alpha .05, power .8). Offline metrics say a change did what it meant to;
they never say people like it.

---

## 1. Song form

**Findings.** The pre-chorus is a distinct section whose job is to build toward the chorus (**summach2011**). Rock
harmony has its own grammar, with IV and bVII far more central than in common-practice harmony (**declercq2011**).
Pop-rock often builds form by accumulating layers rather than by contrast alone (**spicer2004**). Across three decades
of US top-10 singles, instrumental intros got much shorter and the voice and title arrive sooner
(**leveillegauvin2018**). On a streaming service, skips cluster at structural boundaries, so every section change is a
moment a listener decides (**montecchio2020**). Listeners exposed to intact and patchwork versions of a piece liked
both more with repetition and were not very sensitive to large-scale unity (**tan2006**).

**Principles.** `form.roles`, `form.bridge`, `form.fast-hook`.

**Hypothesis F1.** The bridge earns its time: a pop song whose bridge is replaced by another verse of the same length
is completed less often (the final chorus stops being a return).
**Test.** Experiment `pop-no-bridge` (primary `complete`, guardrails `skip`, `down`, `replay`). Offline: the variant's
`bridgeAway` is 0 on every seed and the song keeps its length, so completion is not confounded by duration.

**Hypothesis F2.** Shorter intros lower early skips in song styles without lowering completion.
**Test.** Improvement-engine `section` findings on intro exits; a future `arrangement` experiment on intro length.

- **summach2011** Summach, J. (2011). The structure, function, and genesis of the prechorus. *Music Theory Online*, 17(3). https://doi.org/10.30535/mto.17.3.2
- **declercq2011** de Clercq, T., & Temperley, D. (2011). A corpus analysis of rock harmony. *Popular Music*, 30(1), 47-70. https://doi.org/10.1017/S026114301000067X
- **spicer2004** Spicer, M. (2004). (Ac)cumulative form in pop-rock music. *Twentieth-Century Music*, 1(1), 29-64. https://doi.org/10.1017/S1478572204000052
- **leveillegauvin2018** Léveillé Gauvin, H. (2018). Drawing listener attention in popular music: Testing five musical features arising from the theory of attention economy. *Musicae Scientiae*, 22(3), 291-304. https://doi.org/10.1177/1029864917698010
- **montecchio2020** Montecchio, N., Roy, P., & Pachet, F. (2020). The skipping behavior of users of music streaming services and its relation to musical structure. *PLOS ONE*, 15(9), e0239418. https://doi.org/10.1371/journal.pone.0239418
- **tan2006** Tan, S.-L., Spackman, M. P., & Peaslee, C. L. (2006). The effects of repeated exposure on liking and judgments of musical unity of intact and patchwork compositions. *Music Perception*, 23(5), 407-421. https://doi.org/10.1525/mp.2006.23.5.407

## 2. Musical memory and earworms

**Findings.** Songs that become earworms are more popular and recent, faster, have a common overall melodic contour,
and carry unusual interval patterns (**jakubowski2017**). Involuntary musical imagery is triggered mostly by recent
and repeated exposure, memory associations and low-attention states (**williamson2012**). Billboard songs with more
repetitive lyrics were more likely to reach number one and got there faster, explained by processing fluency
(**nunes2015**). Adding repetition to unfamiliar art-music excerpts made listeners enjoy them more and judge them more
likely written by a human (**margulis2013**). Catchiness can be measured at scale as how fast a fragment is
recognised (**burgoyne2013**).

**Principles.** `memory.repeat-vary`, `memory.contour`.

**Hypothesis M1.** Within a style, songs with higher `motifRecall` (more literal hook returns) get more `replay` and
`return`, up to a point past which `skip` rises (an inverted U).
**Test.** Benchmark `motifRecall` per song is deterministic from the seed, so the improvement engine can bucket listens
by it; a `generator` experiment that varies hook-return literalness tests it causally.

**Hypothesis M2.** A hook with one unusual interval inside a common contour is recognised faster in the lab.
**Test.** Blind A/B lab with recognition timing, contour features from `melodyShape()` (`stepShare`, `peakAt`).

- **jakubowski2017** Jakubowski, K., Finkel, S., Stewart, L., & Müllensiefen, D. (2017). Dissecting an earworm: Melodic features and song popularity predict involuntary musical imagery. *Psychology of Aesthetics, Creativity, and the Arts*, 11(2), 122-135. https://doi.org/10.1037/aca0000090
- **williamson2012** Williamson, V. J., Jilka, S. R., Fry, J., Finkel, S., Müllensiefen, D., & Stewart, L. (2012). How do "earworms" start? Classifying the everyday circumstances of involuntary musical imagery. *Psychology of Music*, 40(3), 259-284. https://doi.org/10.1177/0305735611418553
- **nunes2015** Nunes, J. C., Ordanini, A., & Valsesia, F. (2015). The power of repetition: Repetitive lyrics in a song increase processing fluency and drive market success. *Journal of Consumer Psychology*, 25(2), 187-199. https://doi.org/10.1016/j.jcps.2014.12.004
- **margulis2013** Margulis, E. H. (2013). Aesthetic responses to repetition in unfamiliar music. *Empirical Studies of the Arts*, 31(1), 45-57. https://doi.org/10.2190/EM.31.1.c
- **burgoyne2013** Burgoyne, J. A., Bountouridis, D., Van Balen, J., & Honing, H. (2013). Hooked: A game for discovering what makes music catchy. *Proceedings of the 14th International Society for Music Information Retrieval Conference (ISMIR)*. https://ismir2013.ismir.net/wp-content/uploads/2013/09/101_Paper.pdf

## 3. Expectation and surprise

**Findings.** Huron's ITPRA theory splits expectation into imagination, tension, prediction, reaction and appraisal:
accurate prediction is itself rewarded, and a surprise can be appraised as pleasant (**huron2006**). IDyOM learns
style statistics with variable-order models and predicts listeners' expectedness (information content) and
uncertainty (entropy) (**pearce2012**); these expectations are learned through exposure, that is, enculturation
(**pearce2018**). In 80,000 chords from US Billboard songs, pleasure was highest for surprising chords in predictable
contexts and for unsurprising chords in uncertain contexts (**cheung2019**). Liking of melodies followed an inverted U
over predictability, with intermediate information content and entropy preferred (**gold2019**).

**Principles.** `expect.lift`, `expect.surprise-in-context`.

**Hypothesis E1.** A bigger chorus lift (the verse sung a scale step lower) raises replays without raising
skips: the arrival is predictable in kind but larger in size.
**Test.** Experiment `pop-chorus-lift` (primary `replay`, guardrails `skip`, `down`, `complete`). Offline: `chorusLift`
never falls on any seed and its median rises (9 to 10 semitones on the 8 benchmark seeds).

**Hypothesis E2.** New chords placed after the chorus has repeated (low uncertainty) are rewarded more than the same
chords placed early.
**Test.** Composition `bridgeAway` with section position; a later `arrangement` experiment. A per-chord
information-content metric (an IDyOM-style model trained on our own corpus) is a candidate benchmark addition.

- **huron2006** Huron, D. (2006). *Sweet Anticipation: Music and the Psychology of Expectation*. MIT Press. https://doi.org/10.7551/mitpress/6575.001.0001
- **pearce2012** Pearce, M. T., & Wiggins, G. A. (2012). Auditory expectation: The information dynamics of music perception and cognition. *Topics in Cognitive Science*, 4(4), 625-652. https://doi.org/10.1111/j.1756-8765.2012.01214.x
- **pearce2018** Pearce, M. T. (2018). Statistical learning and probabilistic prediction in music cognition: Mechanisms of stylistic enculturation. *Annals of the New York Academy of Sciences*, 1423(1), 378-395. https://doi.org/10.1111/nyas.13654
- **cheung2019** Cheung, V. K. M., Harrison, P. M. C., Meyer, L., Pearce, M. T., Haynes, J.-D., & Koelsch, S. (2019). Uncertainty and surprise jointly predict musical pleasure and amygdala, hippocampus, and auditory cortex activity. *Current Biology*, 29(23), 4084-4092. https://doi.org/10.1016/j.cub.2019.09.067
- **gold2019** Gold, B. P., Pearce, M. T., Mas-Herrero, E., Dagher, A., & Zatorre, R. J. (2019). Predictability and uncertainty in the pleasure of music: A reward for learning? *Journal of Neuroscience*, 39(47), 9397-9409. https://doi.org/10.1523/JNEUROSCI.0428-19.2019

## 4. Groove and syncopation

**Findings.** Wanting to move and pleasure follow an inverted U over syncopation: medium syncopation is rated highest
(**witek2014**). Medium rhythmic complexity maximises groove, and harmonic complexity interacts with it
(**matthews2019**). Groove, defined as wanting to move, is rated consistently across listeners and goes with easier
sensorimotor coupling (**janata2012**; **madison2006**). Quantised versions of expert swing and funk recordings
grooved as much as the originals, while exaggerated microtiming lowered groove (**senn2016**). Microtiming deviations in
short rhythms generally lowered groove ratings compared with quantised versions (**davies2013**).

**Principles.** `groove.medium-syncopation`, `groove.systematic-feel`.

**Hypothesis G1.** In deep house, less swing (0.30 to 0.20) makes no difference to completions or loves: feel lives in
the idiom's systematic timing, not in more offset.
**Test.** Experiment `deephouse-swing` (primary `complete`, guardrails `skip`, `down`, `love`; a `no_difference`
verdict supports the hypothesis). Offline: the variant's swing is lower and nothing else changes.

**Hypothesis G2.** Club styles whose kit syncopation sits in the middle of our range get more completions than the
extremes.
**Test.** Needs a syncopation index on the drum grid (Witek et al.'s measure) added to the composition benchmark first,
then segment findings by its tercile.

- **witek2014** Witek, M. A. G., Clarke, E. F., Wallentin, M., Kringelbach, M. L., & Vuust, P. (2014). Syncopation, body-movement and pleasure in groove music. *PLOS ONE*, 9(4), e94446. https://doi.org/10.1371/journal.pone.0094446
- **matthews2019** Matthews, T. E., Witek, M. A. G., Heggli, O. A., Penhune, V. B., & Vuust, P. (2019). The sensation of groove is affected by the interaction of rhythmic and harmonic complexity. *PLOS ONE*, 14(1), e0204539. https://doi.org/10.1371/journal.pone.0204539
- **janata2012** Janata, P., Tomic, S. T., & Haberman, J. M. (2012). Sensorimotor coupling in music and the psychology of the groove. *Journal of Experimental Psychology: General*, 141(1), 54-75. https://doi.org/10.1037/a0024208
- **madison2006** Madison, G. (2006). Experiencing groove induced by music: Consistency and phenomenology. *Music Perception*, 24(2), 201-208. https://doi.org/10.1525/mp.2006.24.2.201
- **senn2016** Senn, O., Kilchenmann, L., von Georgi, R., & Bullerjahn, C. (2016). The effect of expert performance microtiming on listeners' experience of groove in swing or funk music. *Frontiers in Psychology*, 7, 1487. https://doi.org/10.3389/fpsyg.2016.01487
- **davies2013** Davies, M., Madison, G., Silva, P., & Gouyon, F. (2013). The effect of microtiming deviations on the perception of groove in short rhythms. *Music Perception*, 30(5), 497-510. https://doi.org/10.1525/mp.2013.30.5.497

## 5. Emotion and chills

**Findings.** Intensely pleasurable chills engage the brain's reward circuitry (**blood2001**), with dopamine released
during anticipation and again at the peak (**salimpoor2011**). Chills are individual but tend to follow the entry of a
voice, a rise in loudness and the start of a new section (**grewe2007**); chill passages often expand the frequency
range and get louder (**guhn2007**). Tears go with appoggiaturas and melodic sequences, shivers with new harmonies and
sudden dynamic changes (**sloboda1991**). Music induces emotion through several mechanisms, including expectancy,
emotional contagion and episodic memory, so one feature never explains it alone (**juslinvastfjall2008**).

**Principle.** `emotion.peak-last`.

**Hypothesis C1.** The last chorus being the densest, highest and loudest section raises `complete` and `replay` over
a last chorus that only repeats the first.
**Test.** Already a tested principle (`test/longform.mjs` P4, audio-benchmark section LUFS); the causal read is an
`arrangement` experiment that holds the final chorus at chorus-1 density.

- **blood2001** Blood, A. J., & Zatorre, R. J. (2001). Intensely pleasurable responses to music correlate with activity in brain regions implicated in reward and emotion. *PNAS*, 98(20), 11818-11823. https://doi.org/10.1073/pnas.191355898
- **salimpoor2011** Salimpoor, V. N., Benovoy, M., Larcher, K., Dagher, A., & Zatorre, R. J. (2011). Anatomically distinct dopamine release during anticipation and experience of peak emotion to music. *Nature Neuroscience*, 14(2), 257-262. https://doi.org/10.1038/nn.2726
- **grewe2007** Grewe, O., Nagel, F., Kopiez, R., & Altenmüller, E. (2007). Listening to music as a re-creative process: Physiological, psychological, and psychoacoustical correlates of chills and strong emotions. *Music Perception*, 24(3), 297-314. https://doi.org/10.1525/mp.2007.24.3.297
- **guhn2007** Guhn, M., Hamm, A., & Zentner, M. (2007). Physiological and musico-acoustic correlates of the chill response. *Music Perception*, 24(5), 473-484. https://doi.org/10.1525/mp.2007.24.5.473
- **sloboda1991** Sloboda, J. A. (1991). Music structure and emotional response: Some empirical findings. *Psychology of Music*, 19(2), 110-120. https://doi.org/10.1177/0305735691192002
- **juslinvastfjall2008** Juslin, P. N., & Västfjäll, D. (2008). Emotional responses to music: The need to consider underlying mechanisms. *Behavioral and Brain Sciences*, 31(5), 559-575. https://doi.org/10.1017/S0140525X08005293

## 6. Vocal performance and expressivity

**Findings.** Voices and instruments communicate emotion with the same acoustic code (tempo, loudness, timbre, pitch
level and its variability, microstructural regularity) (**juslinlaukka2003**). Emotion in singing largely follows the
acoustic patterns of emotional speech, within the constraints a melody sets (**scherer2015**). Rules such as the phrase
arch, duration contrast and final lengthening make computer performances sound more musical (**friberg2006**).
Performers share phrase-final lengthening while differing widely in the details (**repp1992**). Objective pitch
measures (interval deviation, contour errors) track expert judgments of singing accuracy closely
(**larrouymaestri2013**).

**Principle.** `vocal.singable`.

**Hypothesis V1.** Lead lines with phrase-final lengthening and a phrase arch in velocity get fewer `sounds_bad`
downs than flat-velocity lines.
**Test.** Composition `phraseBars`, `peakAt`, `stepShare` (`docs/melody.md`) as the floor; the causal read is a
`sound` experiment on velocity shaping. For the neural singer, objective pitch accuracy against the written melody is a
candidate gate.

- **juslinlaukka2003** Juslin, P. N., & Laukka, P. (2003). Communication of emotions in vocal expression and music performance: Different channels, same code? *Psychological Bulletin*, 129(5), 770-814. https://doi.org/10.1037/0033-2909.129.5.770
- **scherer2015** Scherer, K. R., Sundberg, J., Tamarit, L., & Salomão, G. L. (2015). Comparing the acoustic expression of emotion in the speaking and the singing voice. *Computer Speech & Language*, 29(1), 218-235. https://doi.org/10.1016/j.csl.2013.10.002
- **friberg2006** Friberg, A., Bresin, R., & Sundberg, J. (2006). Overview of the KTH rule system for musical performance. *Advances in Cognitive Psychology*, 2(2), 145-161. https://doi.org/10.2478/v10053-008-0052-x
- **repp1992** Repp, B. H. (1992). Diversity and commonality in music performance: An analysis of timing microstructure in Schumann's "Träumerei". *Journal of the Acoustical Society of America*, 92(5), 2546-2568. https://doi.org/10.1121/1.404425
- **larrouymaestri2013** Larrouy-Maestri, P., Lévêque, Y., Schön, D., Giovanni, A., & Morsomme, D. (2013). The evaluation of singing voice accuracy: A comparison between subjective and objective methods. *Journal of Voice*, 27(2), 259.e1-259.e5. https://doi.org/10.1016/j.jvoice.2012.11.003

## 7. Listener preference learning and recommendation

**Findings.** Music preferences cluster into a few dimensions that relate to personality (**rentfrow2003**). Most
studies support an inverted U of liking over complexity and familiarity (**chmiel2017**). Implicit feedback (plays,
skips) is preference with a confidence, and the absence of a play is not a dislike (**hu2008**). Music recommendation
still struggles with cold start, context and intent, and evaluation beyond accuracy (**schedl2018**). Large session
logs with skip labels make skip prediction a measurable task (**brost2019**). Social influence makes hits unequal and
unpredictable, so popularity alone is a weak quality signal (**salganik2006**).

**Principles.** `listener.separate-signals`, `listener.familiar-complex`.

**Hypothesis L1.** For a style with a cohort `split` finding, changing who hears it (targeting) improves its metrics
more than changing its sound.
**Test.** Improvement-engine `targeting` lever proposals, compared with `sound` proposals in the same style.

- **rentfrow2003** Rentfrow, P. J., & Gosling, S. D. (2003). The do re mi's of everyday life: The structure and personality correlates of music preferences. *Journal of Personality and Social Psychology*, 84(6), 1236-1256. https://doi.org/10.1037/0022-3514.84.6.1236
- **chmiel2017** Chmiel, A., & Schubert, E. (2017). Back to the inverted-U for music preference: A review of the literature. *Psychology of Music*, 45(6), 886-909. https://doi.org/10.1177/0305735617697507
- **hu2008** Hu, Y., Koren, Y., & Volinsky, C. (2008). Collaborative filtering for implicit feedback datasets. *Proceedings of the 2008 IEEE International Conference on Data Mining (ICDM)*, 263-272. https://doi.org/10.1109/ICDM.2008.22
- **schedl2018** Schedl, M., Zamani, H., Chen, C.-W., Deldjoo, Y., & Elahi, M. (2018). Current challenges and visions in music recommender systems research. *International Journal of Multimedia Information Retrieval*, 7(2), 95-116. https://doi.org/10.1007/s13735-018-0154-2
- **brost2019** Brost, B., Mehrotra, R., & Jehan, T. (2019). The Music Streaming Sessions Dataset. *Proceedings of The Web Conference (WWW 2019)*, 2594-2600. https://doi.org/10.1145/3308558.3313641
- **salganik2006** Salganik, M. J., Dodds, P. S., & Watts, D. J. (2006). Experimental study of inequality and unpredictability in an artificial cultural market. *Science*, 311(5762), 854-856. https://doi.org/10.1126/science.1121066

## 8. Generative-music evaluation

**Findings.** MusicLM reported FAD and text-adherence metrics alongside human pairwise listening tests, and released
MusicCaps for evaluation (**agostinelli2023**). MusicGen paired FAD, KL and CLAP scores with human ratings of quality
and text relevance (**copet2023**). MusicRL fine-tuned MusicLM on 300,000 pairwise preferences from real users; its
ablations show text adherence and audio quality explain only part of what people prefer (**cideron2024**). FAD was
introduced as a reference-free metric for music enhancement (**kilgour2019**), but for generated music it suffers from
sample-size bias and depends heavily on the embedding and reference set (**gui2024**). Side-by-side with a listening
study, commonly used objective metrics were insufficient to describe perceived quality (**vinay2022**).

**Principle.** `eval.listen-not-just-score`.

**Hypothesis X1.** Our audio-benchmark verdicts predict `sounds_bad` downs (a floor), but not loves or replays.
**Test.** Join each listen's style/seed to its benchmark verdict and compare `down` reasons and `love` by verdict.

## 9. Listening tests and online experiments (methods)

**Findings.** MUSHRA rates systems on 0-100 against a hidden reference and anchors (**itu1534**). Objective evaluation
of symbolic music can compare feature distributions (intra- and inter-set distances) of generated and reference sets
(**yang2020**). Listener panels differ in musical sophistication, which can be measured with the Gold-MSI
(**mullensiefen2014**). Online experiments need one primary metric, guardrails, a pre-set sample size and checks such
as sample-ratio mismatch (**kohavi2020**).

**Use.** The blind A/B lab and any external listening test record Gold-MSI and use hidden references; every proposal
in `PROPOSED` names its primary metric, guardrails and listens per arm before it starts.

- **agostinelli2023** Agostinelli, A., Denk, T. I., Borsos, Z., et al. (2023). MusicLM: Generating music from text. *arXiv:2301.11325*. https://arxiv.org/abs/2301.11325
- **copet2023** Copet, J., Kreuk, F., Gat, I., et al. (2023). Simple and controllable music generation. *Advances in Neural Information Processing Systems 36 (NeurIPS 2023)*. https://proceedings.neurips.cc/paper_files/paper/2023/hash/94b472a1842cd7c56dcb125fb2765fbd-Abstract-Conference.html
- **cideron2024** Cideron, G., Girgin, S., Verzetti, M., et al. (2024). MusicRL: Aligning music generation to human preferences. *Proceedings of the 41st International Conference on Machine Learning (ICML)*, PMLR 235. https://proceedings.mlr.press/v235/cideron24a.html
- **kilgour2019** Kilgour, K., Zuluaga, M., Roblek, D., & Sharifi, M. (2019). Fréchet Audio Distance: A reference-free metric for evaluating music enhancement algorithms. *Proceedings of Interspeech 2019*, 2350-2354. https://doi.org/10.21437/Interspeech.2019-2219
- **gui2024** Gui, A., Gamper, H., Braun, S., & Emmanouilidou, D. (2024). Adapting Frechet Audio Distance for generative music evaluation. *Proceedings of ICASSP 2024*, 1331-1335. https://doi.org/10.1109/ICASSP48485.2024.10446663
- **vinay2022** Vinay, A., & Lerch, A. (2022). Evaluating generative audio systems and their metrics. *Proceedings of the 23rd International Society for Music Information Retrieval Conference (ISMIR)*. https://arxiv.org/abs/2209.00130
- **itu1534** ITU-R. (2015). Recommendation BS.1534-3: Method for the subjective assessment of intermediate quality level of audio systems (MUSHRA). https://www.itu.int/rec/R-REC-BS.1534-3-201510-I
- **yang2020** Yang, L.-C., & Lerch, A. (2020). On the evaluation of generative models in music. *Neural Computing and Applications*, 32(9), 4773-4784. https://doi.org/10.1007/s00521-018-3849-7
- **mullensiefen2014** Müllensiefen, D., Gingras, B., Musil, J., & Stewart, L. (2014). The musicality of non-musicians: An index for assessing musical sophistication in the general population. *PLOS ONE*, 9(2), e89642. https://doi.org/10.1371/journal.pone.0089642
- **kohavi2020** Kohavi, R., Tang, D., & Xu, Y. (2020). *Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing*. Cambridge University Press. https://doi.org/10.1017/9781108653985

## Proposed experiments

| id | principle | scope | change (variant arm only) | primary | listens per arm |
| --- | --- | --- | --- | --- | --- |
| `pop-no-bridge` | `form.bridge` | pop, GENERATE | the bridge becomes another verse of the same length | `complete` | 1531 |
| `pop-chorus-lift` | `expect.lift` | pop, GENERATE | the verse melody one scale step lower | `replay` | 1496 |
| `deephouse-swing` | `groove.systematic-feel` | deep house, GENERATE | swing 0.30 to 0.20 | `complete` | 1531 |

Listens per arm assume a 45% completion rate (detect 5 points) and an 8% replay rate (detect 3 points); recompute them
from the improvement report's real rates for the scope before starting one. Only one runs at a time per scope.

## Open questions

- Which offline metric best predicts replays? Candidates: `motifRecall`, `chorusLift`, a syncopation index, per-chord
  information content.
- Is FAD with a music-trained embedding (per **gui2024**) worth adding to the audio benchmark as an outlier detector,
  given that our references would be our own renders?
- How much of our listeners' taste is cohort (device, day of use) rather than sound?
