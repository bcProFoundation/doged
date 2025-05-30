const renderHash = data => {
    let minifiedHash = minifyBlockID(data.txHash);
    if (data.blockHeight === 0) {
        return (
            '<a style="color:#CD0BC3" href="/tx/' +
            data.txHash +
            '">' +
            minifiedHash +
            '</a>'
        );
    } else {
        return '<a href="/tx/' + data.txHash + '">' + minifiedHash + '</a>';
    }
};

var today = Date.now() / 1000;
var fiveYearsAgo = today - 157800000;

const renderSize = size => formatByteSize(size);

const renderInput = data => {
    const txDate = data.timestamp;
    let fiveIcon = '';
    if (txDate < fiveYearsAgo) {
        fiveIcon =
            '<div class="age-icon"><img src="/assets/five-years-icon.png" /><span>Over Five<br />Years Old</span></div>';
    }
    return (
        '<div class="age-icons-ctn">' +
        fiveIcon +
        `<div class="input-margin">${data.numInputs}</div></div>`
    );
};

const escapeHtml = unsafe => {
    return unsafe
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
};

const renderOutput = (satsOutput, _type, row) => {
    if (row.token) {
        var ticker =
            '<a href="/tx/' +
            row.txHash +
            '" class="num-col-suffix" data-suffix=' +
            escapeHtml(row.token.tokenTicker) +
            '></a>';
        return renderAmount(row.stats.tokenOutput, row.token.decimals) + ticker;
    }
    return (
        '<div class="num-col-suffix" data-suffix="DOGE">' +
        renderSats(row.stats.satsOutput) +
        '</div>'
    );
};

const updateLoading = status => {
    if (status) {
        $('#txs-table > tbody').addClass('blur');
        $('.loader__container--fullpage').removeClass('hidden');
        $('#pagination').addClass('hidden');
        $('#footer').addClass('hidden');
    } else {
        $('#txs-table > tbody').removeClass('blur');
        $('.loader__container--fullpage').addClass('hidden');
        $('#pagination').removeClass('hidden');
        $('#footer').removeClass('hidden');
    }
};

// UI actions
const goToPage = (event, page) => {
    event.preventDefault();
    reRenderPage({ page });
};

// UI presentation elements
const datatable = () => {
    const blockHash = $('#block-hash').text();

    $('#txs-table').DataTable({
        paging: false,
        searching: false,
        lengthMenu: [25, 50, 100, 200],
        pageLength: DEFAULT_ROWS_PER_PAGE,
        language: {
            loadingRecords: '',
            zeroRecords: '',
            emptyTable: '',
        },
        order: [],
        responsive: {
            details: {
                type: 'column',
                target: -1,
            },
        },
        columnDefs: [
            {
                className: 'dtr-control',
                orderable: false,
                targets: -1,
            },
        ],
        columns: [
            {
                data: { txHash: 'txHash', blockHeight: 'blockHeight' },
                title: 'ID',
                className: 'hash',
                render: renderHash,
                orderable: false,
            },
            {
                data: 'size',
                title: 'Size',
                render: renderSize,
                className: 'text-right',
                orderSequence: ['desc', 'asc'],
                type: 'file-size',
                targets: 0,
            },
            {
                name: 'fee',
                title: 'Fee',
                css: 'fee',
                render: renderFee,
                className: 'text-right',
                orderSequence: ['desc', 'asc'],
                type: 'html-num-fmt',
            },
            {
                data: { numInputs: 'numInputs' },
                title: 'Inputs',
                className: 'text-right',
                render: renderInput,
                orderSequence: ['desc', 'asc'],
            },
            {
                data: 'numOutputs',
                title: 'Outputs',
                className: 'text-right',
                orderSequence: ['desc', 'asc'],
            },
            {
                data: 'satsOutput',
                title: 'Output Amount',
                render: renderOutput,
                className: 'text-right',
                orderSequence: ['desc', 'asc'],
            },
            { name: 'responsive', render: () => '' },
        ],
    });

    params = window.state.getParameters();
    const page_size = params.rows;
    $('#txs-table').dataTable().api().page.len(page_size);
    refreshTxsTablePage(0);
};

// events
$(window).resize(() => {
    const { currentPage, pageArray } =
        window.pagination.generatePaginationUIParams();
    window.pagination.generatePaginationUI(currentPage, pageArray);
    $('#blocks-table').DataTable().responsive.rebuild();
    $('#blocks-table').DataTable().responsive.recalc();
});

$('#txs-table').on('init.dt', () => {
    $('.datatable__length-placeholder').remove();
});

$('#txs-table').on('length.dt', (e, settings, rows) => {
    params = window.state.getParameters();

    if (params.rows !== rows) {
        reRenderPage({ rows });
    }
});

$('#txs-table').on('xhr.dt', () => {
    updateLoading(false);
});

function refreshTxsTablePage(page) {
    const blockHash = $('#block-hash').text();
    params = window.state.getParameters();
    const page_size = params.rows;

    $('#txs-table')
        .dataTable()
        .api()
        .ajax.url(`/api/block/${blockHash}/transactions/${page}/${page_size}`)
        .load();
}

// Basically a fake refresh, dynamically updates everything
// according to new params
// updates: URL, table and pagination
const reRenderPage = params => {
    if (params) {
        window.state.updateParameters(params);

        if (params.page) {
            // DataTable pages start at index 0, so we oblige
            $('#txs-table')
                .DataTable()
                .page(params.page - 1)
                .draw(false);

            refreshTxsTablePage(params.page - 1);
        }
    }

    const { currentPage, pageArray } =
        window.pagination.generatePaginationUIParams();
    window.pagination.generatePaginationUI(currentPage, pageArray);
};

// main
$(document).ready(() => {
    // init all UI elements
    datatable();

    // global state update
    reRenderPage();
});
