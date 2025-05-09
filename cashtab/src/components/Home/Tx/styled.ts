// Copyright (c) 2024 The Bitcoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

import styled, { css } from 'styled-components';
import { Link } from 'react-router-dom';
import { XecTxType } from 'chronik';

export const TxWrapper = styled.div`
    border-bottom: 1px solid ${props => props.theme.border};
    display: flex;
    flex-direction: column;
    gap: 12px;
    svg {
        width: 33px;
        height: 33px;
    }
    img {
        height: 33px;
    }
    box-sizing: border-box;
    *,
    *:before,
    *:after {
        box-sizing: inherit;
    }
`;
export const Collapse = styled.div`
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
`;
const Incoming = css`
    color: ${props => props.theme.accent};
    fill: ${props => props.theme.accent};
`;
const Genesis = css`
    color: ${props => props.theme.genesisGreen};
    fill: ${props => props.theme.genesisGreen};
    svg {
        fill: ${props => props.theme.genesisGreen};
    }
    path {
        fill: ${props => props.theme.genesisGreen};
    }
    g {
        fill: ${props => props.theme.genesisGreen};
    }
`;
const Burn = css`
    color: ${props => props.theme.secondaryAccent};
    fill: ${props => props.theme.secondaryAccent};
    svg {
        fill: ${props => props.theme.secondaryAccent};
    }
    path {
        fill: ${props => props.theme.secondaryAccent};
    }
    g {
        fill: ${props => props.theme.secondaryAccent};
    }
`;
export const MainRow = styled.div<{
    type?: XecTxType;
}>`
    display: flex;
    justify-content: space-between;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    width: 100%;
    color: ${props => props.theme.primaryText};
    fill: ${props => props.theme.primaryText};
    ${props =>
        (props.type === 'Received' ||
            props.type === 'Staking Reward' ||
            props.type === 'Coinbase Reward') &&
        Incoming}
`;
export const MainRowLeft = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
`;
export const AppTxIcon = styled.div``;
export const TxDescCol = styled.div`
    flex-direction: row;
`;
// Top row of TxDescCol
export const TxDescSendRcvMsg = styled.div`
    display: inline-block;
`;
export const TxDesc = styled.div`
    display: flex;
    flex-wrap: wrap;
    text-align: left;
    width: 100%;
    align-items: center;
    gap: 6px;
`;
// Bottom row of TxDescCol
export const Timestamp = styled.div`
    display: flex;
    width: 100%;
    text-align: left;
    font-size: 14px;
    color: ${props => props.theme.secondaryText};
`;
export const AmountCol = styled.div`
    flex-direction: row;
    justify-content: flex-end;
`;
// Top row of TxAmountCol
export const AmountTop = styled.div`
    display: flex;
    width: 100%;
    justify-content: flex-end;
`;
export const AmountBottom = styled.div`
    display: flex;
    width: 100%;
    color: ${props => props.theme.secondaryText};
    justify-content: flex-end;
`;
export const CashtabMsg = styled.div`
    display: flex;
    width: 100%;
`;
export const TokenEntry = styled.div`
    display: flex;
    width: 100%;
`;
// Button panel for actions on each tx
export const Expand = styled.div<{ showPanel: boolean }>`
    display: flex;
    overflow: hidden;
    height: ${props => (props.showPanel ? '36px' : '0px')};
    visibility: ${props => (props.showPanel ? 'visible' : 'collapse')};
    transition: all 0.5s ease-out;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    svg {
        height: 33px;
        width: 33px;
        fill: ${props => props.theme.primaryText};
    }
    path {
        fill: ${props => props.theme.primaryText};
    }
    g {
        fill: ${props => props.theme.primaryText};
    }
`;
export const ExpandButtonPanel = styled.div`
    display: flex;
`;
export const PanelButton = styled.button`
    border: none;
    background: none;
    cursor: pointer;
`;
export const PanelLink = styled(Link)`
    border: none;
    background: none;
    cursor: pointer;
`;
export const ReplyLink = styled(PanelLink)`
    margin-left: auto;
`;
export const AddressLink = styled.a`
    padding: 0 3px;
`;
export const AppAction = styled.div<{ type?: string }>`
    display: flex;
    gap: 12px;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    padding: 3px 12px;
    ${props => props.type === 'Received' && Incoming}
    border-radius: 9px;
    background-color: ${props => props.theme.secondaryBackground};
    flex-wrap: wrap;
    word-break: break-all;
`;
export const AppDescLabel = styled.div<{ noWordBreak?: boolean }>`
    font-weight: bold;
    word-break: ${props => (props.noWordBreak ? 'normal' : 'break-all')};
`;
export const IconAndLabel = styled.div`
    display: flex;
    gap: 6px;
    align-items: center;
`;
export const AppDescMsg = styled.div`
    overflow-wrap: break-word;
    word-wrap: break-word;
    word-break: break-all;
    text-align: left;
`;
export const TokenAction = styled(AppAction)<{
    tokenTxType?: string;
}>`
    ${props => props.tokenTxType === 'Received' && Incoming}
    ${props =>
        (props.tokenTxType === 'Created' || props.tokenTxType === 'Minted') &&
        Genesis}
        ${props => props.tokenTxType === 'Burned' && Burn}
`;
export const TokenActionHolder = styled.div``;
export const TokenInfoCol = styled.div`
    display: flex;
    flex-direction: column;
`;
export const UnknownMsgColumn = styled.div`
    display: flex;
    flex-direction: column;
    text-align: left;
`;
export const TokenType = styled.div``;
export const TokenName = styled(PanelLink)`
    text-decoration: none;
`;
export const TokenTicker = styled.div``;
export const TokenDesc = styled.div``;
export const ActionLink = styled.a``;
