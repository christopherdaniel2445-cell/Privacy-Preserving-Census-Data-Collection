;; contracts/verification.clar

(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-EPOCH-NOT-FINALIZED u101)
(define-constant ERR-INVALID-PROOF u102)
(define-constant ERR-PROOF-ALREADY-USED u103)
(define-constant ERR-INVALID-SUBMISSION u104)
(define-constant ERR-PROOF-VERIFICATION-FAILED u105)
(define-constant ERR-INVALID-CATEGORY u106)
(define-constant ERR-INVALID-VALUE u107)
(define-constant ERR-PROOF-MISMATCH u108)
(define-constant ERR-SUBMISSION-NOT-FOUND u109)

(define-constant PROOF-HASH-LENGTH u32)
(define-constant MAX-CATEGORIES u10)

(define-map verified-proofs
  (buff 32)
  { epoch: uint, submitter: principal, verified-at: uint }
)

(define-map submission-hashes
  { epoch: uint, submitter: principal }
  (buff 32)
)

(define-read-only (is-proof-verified (proof-hash (buff 32)))
  (map-get? verified-proofs proof-hash)
)

(define-read-only (get-submission-hash (epoch uint) (submitter principal))
  (map-get? submission-hashes { epoch: epoch, submitter: submitter })
)

(define-read-only (get-verified-count (epoch uint))
  (fold + (map (lambda (p) (if (is-eq (get epoch p) epoch) u1 u0)) (map-get? verified-proofs)) u0)
)

(define-private (validate-proof-length (proof (buff 32)))
  (is-eq (len proof) PROOF-HASH-LENGTH)
)

(define-private (validate-category (category uint))
  (< category MAX-CATEGORIES)
)

(define-private (validate-value (value uint))
  (> value u0)
)

(define-private (is-proof-unused (proof-hash (buff 32)))
  (is-none (map-get? verified-proofs proof-hash))
)

(define-private (hash-submission (category uint) (value uint) (location (string-utf8 50)) (age-range uint))
  (sha256 (concat (concat (uint-to-buff category) (uint-to-buff value)) (concat (string-utf8-to-buff location) (uint-to-buff age-range))))
)

(define-private (uint-to-buff (value uint))
  (let ((buff (buff 32)))
    (fold (lambda (i acc) (unwrap-panic (buff-set-byte acc i (get-byte value i)))) (range u32) buff)
  )
)

(define-private (string-utf8-to-buff (str (string-utf8 50)))
  (unwrap-panic (as-max-len? (string-to-buff str) u50))
)

(define-public (verify-submission
  (epoch uint)
  (submitter principal)
  (category uint)
  (value uint)
  (location (string-utf8 50))
  (age-range uint)
  (proof-hash (buff 32))
)
  (let (
    (expected-hash (hash-submission category value location age-range))
    (stored-hash (unwrap! (get-submission-hash epoch submitter) (err ERR-SUBMISSION-NOT-FOUND)))
  )
    (asserts! (is-eq tx-sender submitter) (err ERR-UNAUTHORIZED))
    (asserts! (validate-proof-length proof-hash) (err ERR-INVALID-PROOF))
    (asserts! (is-proof-unused proof-hash) (err ERR-PROOF-ALREADY-USED))
    (asserts! (validate-category category) (err ERR-INVALID-CATEGORY))
    (asserts! (validate-value value) (err ERR-INVALID-VALUE))
    (asserts! (is-eq expected-hash stored-hash) (err ERR-PROOF-MISMATCH))
    (map-set verified-proofs proof-hash
      { epoch: epoch, submitter: submitter, verified-at: block-height }
    )
    (ok true)
  )
)

(define-public (register-submission-hash
  (epoch uint)
  (submitter principal)
  (category uint)
  (value uint)
  (location (string-utf8 50))
  (age-range uint)
)
  (let ((hash (hash-submission category value location age-range)))
    (asserts! (is-eq tx-sender submitter) (err ERR-UNAUTHORIZED))
    (asserts! (is-none (get-submission-hash epoch submitter)) (err ERR-INVALID-SUBMISSION))
    (map-set submission-hashes
      { epoch: epoch, submitter: submitter }
      hash
    )
    (ok hash)
  )
)

(define-public (batch-verify
  (submissions (list 10 { epoch: uint, submitter: principal, category: uint, value: uint, location: (string-utf8 50), age-range: uint, proof-hash: (buff 32) }))
)
  (fold
    (lambda (sub acc)
      (match (verify-submission
        (get epoch sub)
        (get submitter sub)
        (get category sub)
        (get value sub)
        (get location sub)
        (get age-range sub)
        (get proof-hash sub)
      )
        success (ok (cons success acc))
        error (err error)
      )
    )
    submissions
    (ok (list))
  )
)