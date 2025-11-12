(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-EPOCH-CLOSED u101)
(define-constant ERR-EPOCH-NOT-CLOSED u102)
(define-constant ERR-INVALID-DATA u103)
(define-constant ERR-INVALID-PROOF u104)
(define-constant ERR-INVALID-CATEGORY u105)
(define-constant ERR-INVALID-VALUE u106)
(define-constant ERR-OVERFLOW u107)
(define-constant ERR-EMPTY-SUBMISSIONS u108)
(define-constant ERR-VERIFICATION-FAILED u109)
(define-constant ERR-ALREADY-FINALIZED u110)
(define-constant ERR-INVALID-AGGREGATOR u111)

(define-constant EPOCH-DURATION u100)
(define-constant MIN-SUBMISSIONS u3)
(define-constant MAX-CATEGORIES u10)

(define-data-var current-epoch uint u0)
(define-data-var epoch-start-block uint u0)
(define-data-var is-epoch-closed bool false)
(define-data-var aggregator principal tx-sender)

(define-map submissions
  { epoch: uint, submitter: principal }
  { category: uint, value: uint, proof-hash: (buff 32) }
)

(define-map category-totals
  { epoch: uint, category: uint }
  { sum: uint, count: uint }
)

(define-map final-aggregates
  uint
  { total-submissions: uint, averages: (list 10 uint) }
)

(define-read-only (get-current-epoch)
  (var-get current-epoch)
)

(define-read-only (get-epoch-info)
  (ok {
    epoch: (var-get current-epoch),
    start-block: (var-get epoch-start-block),
    is-closed: (var-get is-epoch-closed),
    aggregator: (var-get aggregator)
  })
)

(define-read-only (get-submission (epoch uint) (submitter principal))
  (map-get? submissions { epoch: epoch, submitter: submitter })
)

(define-read-only (get-category-total (epoch uint) (category uint))
  (map-get? category-totals { epoch: epoch, category: category })
)

(define-read-only (get-final-aggregate (epoch uint))
  (map-get? final-aggregates epoch)
)

(define-private (validate-category (category uint))
  (and (>= category u0) (< category MAX-CATEGORIES))
)

(define-private (validate-value (value uint))
  (> value u0)
)

(define-private (validate-proof (proof-hash (buff 32)))
  (not (is-eq proof-hash 0x0000000000000000000000000000000000000000000000000000000000000000))
)

(define-private (is-aggregator)
  (is-eq tx-sender (var-get aggregator))
)

(define-private (is-epoch-open)
  (not (var-get is-epoch-closed))
)

(define-private (has-epoch-ended)
  (>= block-height (+ (var-get epoch-start-block) EPOCH-DURATION))
)

(define-private (safe-add (a uint) (b uint))
  (if (> (+ a b) a) (+ a b) (err ERR-OVERFLOW))
)

(define-private (safe-div (numerator uint) (denominator uint))
  (if (> denominator u0) (/ numerator denominator) u0)
)

(define-public (submit-data (category uint) (value uint) (proof-hash (buff 32)))
  (let (
    (epoch (var-get current-epoch))
    (submitter tx-sender)
  )
    (asserts! (is-epoch-open) (err ERR-EPOCH-CLOSED))
    (asserts! (validate-category category) (err ERR-INVALID-CATEGORY))
    (asserts! (validate-value value) (err ERR-INVALID-VALUE))
    (asserts! (validate-proof proof-hash) (err ERR-INVALID-PROOF))
    (asserts! (is-none (get-submission epoch submitter)) (err ERR-INVALID-DATA))
    (map-set submissions
      { epoch: epoch, submitter: submitter }
      { category: category, value: value, proof-hash: proof-hash }
    )
    (let ((current-total (default-to { sum: u0, count: u0 } (get-category-total epoch category))))
      (map-set category-totals
        { epoch: epoch, category: category }
        {
          sum: (unwrap! (safe-add (get sum current-total) value) (err ERR-OVERFLOW)),
          count: (+ (get count current-total) u1)
        }
      )
    )
    (ok true)
  )
)

(define-public (close-epoch)
  (begin
    (asserts! (is-aggregator) (err ERR-UNAUTHORIZED))
    (asserts! (is-epoch-open) (err ERR-EPOCH-CLOSED))
    (asserts! (has-epoch-ended) (err ERR-EPOCH-NOT-CLOSED))
    (var-set is-epoch-closed true)
    (ok true)
  )
)

(define-public (finalize-epoch)
  (let (
    (epoch (var-get current-epoch))
    (categories (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9))
  )
    (asserts! (is-aggregator) (err ERR-UNAUTHORIZED))
    (asserts! (var-get is-epoch-closed) (err ERR-EPOCH-NOT-CLOSED))
    (asserts! (is-none (get-final-aggregate epoch)) (err ERR-ALREADY-FINALIZED))
    (let (
      (totals (map get-category-total epoch categories))
      (valid-totals (filter (lambda (t) (> (get count t) u0)) totals))
    )
      (asserts! (>= (len valid-totals) u1) (err ERR-EMPTY-SUBMISSIONS))
      (let (
        (averages (map
          (lambda (t) (safe-div (get sum t) (get count t)))
          valid-totals
        ))
        (total-submissions (fold + (map (lambda (t) (get count t)) valid-totals) u0))
      )
        (map-set final-aggregates epoch
          {
            total-submissions: total-submissions,
            averages: (unwrap-panic (as-max-len? averages u10))
          }
        )
        (var-set current-epoch (+ epoch u1))
        (var-set epoch-start-block block-height)
        (var-set is-epoch-closed false)
        (ok {
          epoch: epoch,
          total-submissions: total-submissions,
          averages: averages
        })
      )
    )
  )
)

(define-public (update-aggregator (new-aggregator principal))
  (begin
    (asserts! (is-aggregator) (err ERR-UNAUTHORIZED))
    (var-set aggregator new-aggregator)
    (ok true)
  )
)

(define-public (force-start-new-epoch)
  (begin
    (asserts! (is-aggregator) (err ERR-UNAUTHORIZED))
    (var-set current-epoch (+ (var-get current-epoch) u1))
    (var-set epoch-start-block block-height)
    (var-set is-epoch-closed false)
    (ok (var-get current-epoch))
  )
)