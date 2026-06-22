"fn" @keyword
"let" @keyword
"in" @keyword
"fun" @keyword
"lazy" @keyword
"force" @keyword
"if" @keyword
"then" @keyword
"else" @keyword
(likely) @keyword
(unlikely) @keyword
"tick" @function.builtin
(INTEGER) @number
(eq) @operator
(ne) @operator
(lt) @operator
(le) @operator
(gt) @operator
(ge) @operator
(plus) @operator
(minus) @operator
(star) @operator
(slash) @operator
"(" @punctuation.bracket
")" @punctuation.bracket
"," @punctuation.delimiter
"->" @operator
";" @punctuation.delimiter
"=" @operator
(definition "fn" @keyword)
(force_expr "force" @keyword)
(fun_expr "fun" @keyword)
(if_expr "else" @keyword)
(if_expr "if" @keyword)
(if_expr "then" @keyword)
(lazy_expr "lazy" @keyword)
(let_expr "in" @keyword)
(let_expr "let" @keyword)
(tick "tick" @keyword)
(integer) @number
(fun_expr param: (IDENT) @variable)
(let_expr name: (IDENT) @variable)
(variable name: (IDENT) @variable)
