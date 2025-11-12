(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-EPOCH-CLOSED u101)
(define-constant ERR-INVALID-PROOF u102)
(define-constant ERR-INVALID-CATEGORY u103)
(define-constant ERR-INVALID-VALUE u104)
(define-constant ERR-ALREADY-SUBMITTED u105)
(define-constant ERR-PROOF-VERIFICATION-FAILED u106)
(define-constant ERR-INVALID-LOCATION u107)
(define-constant ERR-INVALID-AGE u108)
(define-constant ERR-INVALID-PROOF-LENGTH u109)

(define-constant MAX-CATEGORIES u10)
(define-constant MIN-VALUE u1)
(define-constant MAX-VALUE u1000)
(define-constant PROOF-HASH-LENGTH u32)

(define-data-var current-epoch uint u0)
(define-data-var epoch-start-block uint u0)
(define-data-var is-epoch-closed bool false)
(define-data-var aggregator principal tx-sender)

(define-map submissions
  { epoch: uint, submitter: principal }
  {
    category: uint,
    value: uint,
    location: (string-utf8 50),
    age-range: uint,
    proof-hash: (buff 32),
    submitted-at: uint
  }
)

(define-map location-totals
  { epoch: uint, location: (string-utf8 50) }
  { count: uint }
)

(define-read-only (get-current-epoch)
  (var-get current-epoch)
)

(define-read-only (get-epoch-status)
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

(define-read-only (get-location-total (epoch uint) (location (string-utf8 50)))
  (map-get? location-totals { epoch: epoch, location: location })
)

(define-private (is-epoch-open)
  (not (var-get is-epoch-closed))
)

(define-private (validate-category (category uint))
  (< category MAX-CATEGORIES)
)

(define-private (validate-value (value uint))
  (and (>= value MIN-VALUE) (<= value MAX-VALUE))
)

(define-private (validate-location (location (string-utf8 50)))
  (and (> (len location) u0) (<= (len location) u50))
)

(define-private (validate-age-range (age uint))
  (and (>= age u0) (<= age u5))
)

(define-private (validate-proof-hash (proof (buff 32)))
  (and (is-eq (len proof) PROOF-HASH-LENGTH) (not (is-eq proof 0x0000000000000000000000000000000000000000000000000000000000000000)))
)

(define-private (has-not-submitted (epoch uint) (submitter principal))
  (is-none (get-submission epoch submitter))
)

(define-public (submit-data
  (category uint)
  (value uint)
  (location (string-utf8 50))
  (age-range uint)
  (proof-hash (buff 32))
)
  (let (
    (epoch (var-get current-epoch))
    (submitter tx-sender)
  )
    (asserts! (is-epoch-open) (err ERR-EPOCH-CLOSED))
    (asserts! (validate-category category) (err ERR-INVALID-CATEGORY))
    (asserts! (validate-value value) (err ERR-INVALID-VALUE))
    (asserts! (validate-location location) (err ERR-INVALID-LOCATION))
    (asserts! (validate-age-range age-range) (err ERR-INVALID-AGE))
    (asserts! (validate-proof-hash proof-hash) (err ERR-INVALID-PROOF-LENGTH))
    (asserts! (has-not-submitted epoch submitter) (err ERR-ALREADY-SUBMITTED))
    (map-set submissions
      { epoch: epoch, submitter: submitter }
      {
        category: category,
        value: value,
        location: location,
        age-range: age-range,
        proof-hash: proof-hash,
        submitted-at: block-height
      }
    )
    (let ((current-total (default-to { count: u0 } (get-location-total epoch location))))
      (map-set location-totals
        { epoch: epoch, location: location }
        { count: (+ (get count current-total) u1) }
      )
    )
    (ok true)
  )
)

(define-public (close-epoch)
  (begin
    (asserts! (is-eq tx-sender (var-get aggregator)) (err ERR-UNAUTHORIZED))
    (asserts! (is-epoch-open) (err ERR-EPOCH-CLOSED))
    (var-set is-epoch-closed true)
    (ok true)
  )
)

(define-public (update-aggregator (new-aggregator principal))
  (begin
    (asserts! (is-eq tx-sender (var-get aggregator)) (err ERR-UNAUTHORIZED))
    (var-set aggregator new-aggregator)
    (ok true)
  )
)

(define-public (force-new-epoch)
  (begin
    (asserts! (is-eq tx-sender (var-get aggregator)) (err ERR-UNAUTHORIZED))
    (var-set current-epoch (+ (var-get current-epoch) u1))
    (var-set epoch-start-block block-height)
    (var-set is-epoch-closed false)
    (ok (var-get current-epoch))
  )
)